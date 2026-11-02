import { getCertificateRegistryContract, getInstitutionRegistryContract, getProvider } from '../config/blockchain.js';
import { getDb } from '../config/database.js';
import { ethers } from 'ethers';

// Cache block timestamps in memory to avoid repeated RPC getBlock calls
const blockTimestampCache = new Map();

async function getBlockTimestamp(provider, blockNumber) {
    if (blockTimestampCache.has(blockNumber)) {
        return blockTimestampCache.get(blockNumber);
    }
    try {
        const block = await provider.getBlock(blockNumber);
        if (block && block.timestamp) {
            const isoTime = new Date(block.timestamp * 1000).toISOString();
            blockTimestampCache.set(blockNumber, isoTime);
            return isoTime;
        }
    } catch (e) {
        console.warn(`Failed to fetch block timestamp for block ${blockNumber}:`, e.message);
    }
    const now = new Date().toISOString();
    blockTimestampCache.set(blockNumber, now);
    return now;
}

// Helper to resolve indexed string topic hash (0x...) to plaintext ID
async function resolveCertificateId(topicOrId, contract) {
    if (!topicOrId || typeof topicOrId !== 'string') return '';
    if (!topicOrId.startsWith('0x') || topicOrId.length !== 66) {
        return topicOrId; // already plaintext
    }

    // 1. Authoritative on-chain contract query
    const crContract = contract || getCertificateRegistryContract();
    if (crContract && typeof crContract.getAllCertificateIds === 'function') {
        try {
            const onChainIds = await crContract.getAllCertificateIds();
            const matched = onChainIds.find(cid => cid && ethers.id(cid) === topicOrId);
            if (matched) return matched;
        } catch (e) {}
    }

    const db = getDb();
    if (!db) return topicOrId;

    // 2. Check DB certificates table
    const certRow = await new Promise((resolve) => {
        db.all('SELECT id FROM certificates', [], (err, rows) => {
            if (err || !rows) return resolve(null);
            const found = rows.find(r => r.id && ethers.id(r.id) === topicOrId);
            resolve(found ? found.id : null);
        });
    });

    if (certRow) return certRow;

    // 3. Check DB blockchain_events table
    const eventRow = await new Promise((resolve) => {
        db.all('SELECT certificateId FROM blockchain_events WHERE certificateId IS NOT NULL', [], (err, rows) => {
            if (err || !rows) return resolve(null);
            const found = rows.find(r => r.certificateId && !r.certificateId.startsWith('0x') && ethers.id(r.certificateId) === topicOrId);
            resolve(found ? found.certificateId : null);
        });
    });

    if (eventRow) return eventRow;

    return topicOrId;
}

async function resolveInstitutionId(topicOrId) {
    if (!topicOrId || typeof topicOrId !== 'string') return '';
    if (!topicOrId.startsWith('0x') || topicOrId.length !== 66) {
        return topicOrId;
    }

    // 1. Authoritative on-chain contract query
    const irContract = getInstitutionRegistryContract();
    if (irContract && typeof irContract.getAllInstitutionIds === 'function') {
        try {
            const onChainIds = await irContract.getAllInstitutionIds();
            const matched = onChainIds.find(id => id && ethers.id(id) === topicOrId);
            if (matched) return matched;
        } catch (e) {}
    }

    const db = getDb();
    if (!db) return topicOrId;

    // 2. Check DB tables
    const row = await new Promise((resolve) => {
        db.all('SELECT institutionId FROM certificates UNION SELECT institutionId FROM blockchain_events WHERE institutionId IS NOT NULL', [], (err, rows) => {
            if (err || !rows) return resolve(null);
            const found = rows.find(r => r.institutionId && !r.institutionId.startsWith('0x') && ethers.id(r.institutionId) === topicOrId);
            resolve(found ? found.institutionId : null);
        });
    });

    return row || topicOrId;
}

export function saveEventToDb({ eventType, certificateId, institutionId, issuer, timestamp, blockNumber, transactionHash, logIndex, version }) {
    const db = getDb();
    if (!db) return;

    db.get(
        `SELECT id, certificateId FROM blockchain_events WHERE transactionHash = ? AND logIndex = ?`,
        [transactionHash, logIndex ?? 0],
        (err, existingRow) => {
            let finalCertId = certificateId || null;
            if (existingRow && existingRow.certificateId && !existingRow.certificateId.startsWith('0x')) {
                if (finalCertId && finalCertId.startsWith('0x')) {
                    finalCertId = existingRow.certificateId;
                }
            }

            db.run(
                `INSERT INTO blockchain_events
                (eventType, certificateId, institutionId, issuer, timestamp, blockNumber, transactionHash, logIndex, version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(transactionHash, logIndex) DO UPDATE SET
                eventType = EXCLUDED.eventType,
                certificateId = CASE
                    WHEN EXCLUDED.certificateId IS NOT NULL AND NOT EXCLUDED.certificateId LIKE '0x%' THEN EXCLUDED.certificateId
                    WHEN blockchain_events.certificateId IS NOT NULL AND NOT blockchain_events.certificateId LIKE '0x%' THEN blockchain_events.certificateId
                    ELSE COALESCE(EXCLUDED.certificateId, blockchain_events.certificateId)
                END,
                institutionId = COALESCE(EXCLUDED.institutionId, blockchain_events.institutionId),
                issuer = COALESCE(EXCLUDED.issuer, blockchain_events.issuer),
                timestamp = EXCLUDED.timestamp,
                blockNumber = EXCLUDED.blockNumber,
                version = COALESCE(EXCLUDED.version, blockchain_events.version)`,
                [
                    eventType,
                    finalCertId,
                    institutionId || null,
                    issuer || null,
                    timestamp,
                    blockNumber,
                    transactionHash,
                    logIndex ?? 0,
                    version ?? 1
                ],
                (err) => {
                    if (err) {
                        console.error(`Error saving event ${eventType} to DB:`, err.message);
                    }
                }
            );
        }
    );
}

export async function backfillHistoricalEvents() {
    console.log('Backfilling historical blockchain events...');
    const certRegistry = getCertificateRegistryContract();
    const instRegistry = getInstitutionRegistryContract();
    const provider = getProvider();

    if (!certRegistry || !instRegistry || !provider) {
        console.warn('Contracts or provider not initialized for event backfilling.');
        return;
    }

    try {
        // Query CertificateRegistry events
        const certIssuedFilter = certRegistry.filters.CertificateIssued();
        const certRevokedFilter = certRegistry.filters.CertificateRevoked();
        const certVersionFilter = certRegistry.filters.CertificateVersionCreated();

        // Query InstitutionRegistry events
        const instRegFilter = instRegistry.filters.InstitutionRegistered();
        const instDeactFilter = instRegistry.filters.InstitutionDeactivated();
        const issuerAuthFilter = instRegistry.filters.IssuerAuthorized();
        const issuerRevFilter = instRegistry.filters.IssuerRevoked();

        let fromBlock = 0;
        try {
            const currentBlock = await provider.getBlockNumber();
            const network = await provider.getNetwork();
            if (network.chainId === 11155111n || Number(network.chainId) === 11155111) {
                fromBlock = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK, 10) : 12048925;
            } else if (currentBlock > 45000) {
                fromBlock = currentBlock - 45000;
            }
        } catch (bErr) {
            console.warn('Could not determine block range for event backfill, defaulting to 0:', bErr.message);
        }

        const [
            issuedLogs,
            revokedLogs,
            versionLogs,
            instRegLogs,
            instDeactLogs,
            issuerAuthLogs,
            issuerRevLogs
        ] = await Promise.all([
            certRegistry.queryFilter(certIssuedFilter, fromBlock, 'latest'),
            certRegistry.queryFilter(certRevokedFilter, fromBlock, 'latest'),
            certRegistry.queryFilter(certVersionFilter, fromBlock, 'latest'),
            instRegistry.queryFilter(instRegFilter, fromBlock, 'latest'),
            instRegistry.queryFilter(instDeactFilter, fromBlock, 'latest'),
            instRegistry.queryFilter(issuerAuthFilter, fromBlock, 'latest'),
            instRegistry.queryFilter(issuerRevFilter, fromBlock, 'latest')
        ]);

        console.log(`Discovered historical logs: ${issuedLogs.length} CertificateIssued, ${revokedLogs.length} CertificateRevoked, ${versionLogs.length} CertificateVersionCreated, ${instRegLogs.length} InstitutionRegistered, ${issuerAuthLogs.length} IssuerAuthorized.`);

        // Process CertificateIssued
        for (const log of issuedLogs) {
            const rawCertId = log.args[0] || (log.topics && log.topics[1]);
            const certId = await resolveCertificateId(rawCertId, certRegistry);

            // Try to lookup institutionId from contract if certId is resolved
            let institutionId = null;
            try {
                const certData = await certRegistry.getCertificate(certId);
                institutionId = certData.institutionId || null;
            } catch (e) {}

            const timestamp = await getBlockTimestamp(provider, log.blockNumber);
            saveEventToDb({
                eventType: 'CertificateIssued',
                certificateId: certId,
                institutionId,
                issuer: log.args[2] || null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: Number(log.args[4] || 1)
            });
        }

        // Process CertificateRevoked
        for (const log of revokedLogs) {
            const rawCertId = log.args[0] || (log.topics && log.topics[1]);
            const certId = await resolveCertificateId(rawCertId, certRegistry);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);

            saveEventToDb({
                eventType: 'CertificateRevoked',
                certificateId: certId,
                institutionId: null,
                issuer: null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: 1
            });
        }

        // Process CertificateVersionCreated
        for (const log of versionLogs) {
            const rawCertId = log.args[0] || (log.topics && log.topics[1]);
            const certId = await resolveCertificateId(rawCertId, certRegistry);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);
            const versionNum = Number(log.args[3] || log.args[2] || 1);

            saveEventToDb({
                eventType: 'CertificateVersionCreated',
                certificateId: certId,
                institutionId: null,
                issuer: null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: versionNum
            });
        }

        // Process InstitutionRegistered
        for (const log of instRegLogs) {
            const rawInstId = log.args[0] || (log.topics && log.topics[1]);
            const instId = await resolveInstitutionId(rawInstId);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);

            saveEventToDb({
                eventType: 'InstitutionRegistered',
                certificateId: null,
                institutionId: instId,
                issuer: log.args[2] || null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: 1
            });
        }

        // Process InstitutionDeactivated
        for (const log of instDeactLogs) {
            const rawInstId = log.args[0] || (log.topics && log.topics[1]);
            const instId = await resolveInstitutionId(rawInstId);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);

            saveEventToDb({
                eventType: 'InstitutionDeactivated',
                certificateId: null,
                institutionId: instId,
                issuer: null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: 1
            });
        }

        // Process IssuerAuthorized
        for (const log of issuerAuthLogs) {
            const rawInstId = log.args[0] || (log.topics && log.topics[1]);
            const instId = await resolveInstitutionId(rawInstId);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);

            saveEventToDb({
                eventType: 'IssuerAuthorized',
                certificateId: null,
                institutionId: instId,
                issuer: log.args[1] || null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: 1
            });
        }

        // Process IssuerRevoked
        for (const log of issuerRevLogs) {
            const rawInstId = log.args[0] || (log.topics && log.topics[1]);
            const instId = await resolveInstitutionId(rawInstId);
            const timestamp = await getBlockTimestamp(provider, log.blockNumber);

            saveEventToDb({
                eventType: 'IssuerRevoked',
                certificateId: null,
                institutionId: instId,
                issuer: log.args[1] || null,
                timestamp,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
                version: 1
            });
        }

        console.log('Historical blockchain events backfilled successfully.');
    } catch (err) {
        console.error('Error during historical event backfilling:', err);
    }
}

export async function startEventSynchronizer() {
    const certRegistry = getCertificateRegistryContract();
    const instRegistry = getInstitutionRegistryContract();
    const provider = getProvider();

    // First perform backfill
    await backfillHistoricalEvents();

    if (certRegistry) {
        certRegistry.on('CertificateIssued', async (rawId, hash, issuer, expiry, version, event) => {
            console.log(`Event [CertificateIssued]`);
            const certId = await resolveCertificateId(rawId, certRegistry);
            let institutionId = null;
            try {
                const certData = await certRegistry.getCertificate(certId);
                institutionId = certData.institutionId || null;
            } catch (e) {}

            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'CertificateIssued',
                certificateId: certId,
                institutionId,
                issuer,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: Number(version || 1)
            });
        });

        certRegistry.on('CertificateRevoked', async (certIdOrTopic, event) => {
            const rawTopic = (typeof certIdOrTopic === 'string') ? certIdOrTopic : (event && event.log ? event.log.topics[1] : null);
            console.log(`Event [CertificateRevoked], identifier/topic: ${rawTopic}`);

            const certId = await resolveCertificateId(rawTopic, certRegistry);

            // Update SQLite certificates status
            const db = getDb();
            if (db) {
                db.all('SELECT id FROM certificates', [], (err, rows) => {
                    if (err || !rows) return;
                    for (const row of rows) {
                        if (row.id === rawTopic || row.id === certId || (rawTopic && ethers.id(row.id) === rawTopic)) {
                            db.run('UPDATE certificates SET status = ? WHERE id = ?', ['REVOKED', row.id], (uErr) => {
                                if (uErr) console.error('Error updating DB on revoke event:', uErr);
                                else console.log(`Successfully synchronized certificate ${row.id} to REVOKED in SQLite.`);
                            });
                        }
                    }
                });
            }

            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'CertificateRevoked',
                certificateId: certId,
                institutionId: null,
                issuer: null,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: 1
            });
        });

        certRegistry.on('CertificateVersionCreated', async (rawId, newHash, newExpiry, newVersion, event) => {
            console.log(`Event [CertificateVersionCreated]: Version ${newVersion}`);
            const certId = await resolveCertificateId(rawId, certRegistry);

            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'CertificateVersionCreated',
                certificateId: certId,
                institutionId: null,
                issuer: null,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: Number(newVersion || 1)
            });
        });
    }

    if (instRegistry) {
        instRegistry.on('InstitutionRegistered', async (rawId, name, wallet, event) => {
            console.log(`Event [InstitutionRegistered]: ${name}`);
            const instId = await resolveInstitutionId(rawId);
            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'InstitutionRegistered',
                certificateId: null,
                institutionId: instId,
                issuer: wallet,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: 1
            });
        });

        instRegistry.on('InstitutionDeactivated', async (rawId, event) => {
            console.log(`Event [InstitutionDeactivated]`);
            const instId = await resolveInstitutionId(rawId);
            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'InstitutionDeactivated',
                certificateId: null,
                institutionId: instId,
                issuer: null,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: 1
            });
        });

        instRegistry.on('IssuerAuthorized', async (rawInstId, issuer, event) => {
            console.log(`Event [IssuerAuthorized]: ${issuer}`);
            const instId = await resolveInstitutionId(rawInstId);
            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'IssuerAuthorized',
                certificateId: null,
                institutionId: instId,
                issuer,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: 1
            });
        });

        instRegistry.on('IssuerRevoked', async (rawInstId, issuer, event) => {
            console.log(`Event [IssuerRevoked]: ${issuer}`);
            const instId = await resolveInstitutionId(rawInstId);
            const log = event && event.log ? event.log : {};
            const blockNumber = log.blockNumber || 0;
            const transactionHash = log.transactionHash || `tx_${Date.now()}`;
            const logIndex = log.index || 0;
            const timestamp = await getBlockTimestamp(provider, blockNumber);

            saveEventToDb({
                eventType: 'IssuerRevoked',
                certificateId: null,
                institutionId: instId,
                issuer,
                timestamp,
                blockNumber,
                transactionHash,
                logIndex,
                version: 1
            });
        });
    }
}
