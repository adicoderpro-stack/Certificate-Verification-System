import { getDb } from '../config/database.js';

export const getAuditEvents = async (req, res) => {
    try {
        const db = getDb();
        if (!db) return res.status(500).json({ error: 'Database not initialized' });

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 25));
        const offset = (page - 1) * limit;

        const { eventType, search, certificateId, institutionId, issuer, source } = req.query;

        const whereClauses = [];
        const params = [];

        if (source && source.trim() !== '' && source.toUpperCase() !== 'ALL') {
            whereClauses.push('source = ?');
            params.push(source.trim().toLowerCase());
        }

        if (eventType && eventType.trim() !== '' && eventType.toUpperCase() !== 'ALL') {
            const ev = eventType.trim();
            if (ev === 'Credential Tampered') {
                whereClauses.push("(eventType = 'Credential Tampered' OR status = 'TAMPERED')");
            } else if (ev === 'Credential Verified') {
                whereClauses.push("(eventType = 'Credential Verified' AND (status IS NULL OR status != 'TAMPERED'))");
            } else {
                whereClauses.push('eventType = ?');
                params.push(ev);
            }
        }

        if (certificateId && certificateId.trim() !== '') {
            whereClauses.push('certificateId = ?');
            params.push(certificateId.trim());
        }

        if (institutionId && institutionId.trim() !== '') {
            whereClauses.push('institutionId = ?');
            params.push(institutionId.trim());
        }

        if (issuer && issuer.trim() !== '') {
            whereClauses.push('issuer = ?');
            params.push(issuer.trim());
        }

        if (search && search.trim() !== '') {
            const searchTerm = `%${search.trim().toLowerCase()}%`;
            whereClauses.push(
                '(LOWER(certificateId) LIKE ? OR LOWER(institutionId) LIKE ? OR LOWER(issuer) LIKE ? OR LOWER(transactionHash) LIKE ? OR LOWER(status) LIKE ? OR LOWER(eventType) LIKE ?)'
            );
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const unifiedQuery = `
            FROM (
                SELECT
                    'bc_' || id as uniqueId,
                    id as rawId,
                    'blockchain' as source,
                    'blockchain' as type,
                    eventType,
                    certificateId,
                    institutionId,
                    issuer,
                    timestamp,
                    blockNumber,
                    transactionHash,
                    logIndex,
                    version,
                    NULL as status,
                    NULL as ipAddress,
                    NULL as userAgent
                FROM blockchain_events

                UNION ALL

                SELECT
                    'vl_' || id as uniqueId,
                    id as rawId,
                    'application' as source,
                    'verification' as type,
                    CASE WHEN status = 'TAMPERED' THEN 'Credential Tampered' ELSE 'Credential Verified' END as eventType,
                    certificateId,
                    NULL as institutionId,
                    NULL as issuer,
                    timestamp,
                    NULL as blockNumber,
                    NULL as transactionHash,
                    NULL as logIndex,
                    1 as version,
                    status,
                    ipAddress,
                    userAgent
                FROM verification_logs
            ) unified_audit
        `;

        // Query total unified events count
        const totalCount = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count ${unifiedQuery} ${whereSql}`, params, (err, row) => {
                if (err) return reject(err);
                resolve(row ? row.count : 0);
            });
        });

        // Query max block number from blockchain events
        const latestBlock = await new Promise((resolve) => {
            db.get(`SELECT MAX(blockNumber) as maxBlock FROM blockchain_events`, [], (err, row) => {
                resolve(err || !row || !row.maxBlock ? 0 : Number(row.maxBlock));
            });
        });

        // Query paginated unified events sorted chronologically by timestamp descending
        const queryParams = [...params, limit, offset];
        const events = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * ${unifiedQuery} ${whereSql} ORDER BY timestamp DESC, rawId DESC LIMIT ? OFFSET ?`,
                queryParams,
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });

        const totalPages = Math.ceil(totalCount / limit) || 1;

        res.json({
            events,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages
            },
            latestBlock
        });
    } catch (error) {
        console.error('Error fetching unified audit events:', error);
        res.status(500).json({ error: 'Failed to fetch audit events', details: error.message });
    }
};
