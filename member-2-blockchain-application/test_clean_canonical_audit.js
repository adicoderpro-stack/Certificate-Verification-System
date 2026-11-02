import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runCleanCanonicalAudit() {
    console.log('================================================================================');
    console.log('CREDCHAIN CLEAN CANONICAL ARCHITECTURE & SECURITY ISOLATION AUDIT');
    console.log('================================================================================');

    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');

    // 1. Network Audit
    const network = await provider.getNetwork();
    console.log('\n[1. NETWORK AUDIT]');
    console.log(`  Chain ID:             ${network.chainId}`);
    console.log(`  Network Name:         ${network.name}`);
    if (network.chainId !== 31337n) {
        throw new Error(`FATAL: Expected Hardhat local chain ID 31337, got ${network.chainId}`);
    }

    const member2Dir = __dirname;
    const contractsDir = path.join(member2Dir, 'src/contracts');

    const irAbi = JSON.parse(fs.readFileSync(path.join(contractsDir, 'InstitutionRegistry.json'), 'utf8')).abi;
    const crAbi = JSON.parse(fs.readFileSync(path.join(contractsDir, 'CertificateRegistry.json'), 'utf8')).abi;
    const dcAbi = JSON.parse(fs.readFileSync(path.join(contractsDir, 'DigitalCredential.json'), 'utf8')).abi;

    const envContent = fs.readFileSync(path.join(member2Dir, '.env'), 'utf8');
    const irAddress = envContent.match(/INSTITUTION_REGISTRY_ADDRESS=(0x[0-9a-fA-F]+)/)[1];
    const crAddress = envContent.match(/CERTIFICATE_REGISTRY_ADDRESS=(0x[0-9a-fA-F]+)/)[1];
    const dcAddress = envContent.match(/DIGITAL_CREDENTIAL_ADDRESS=(0x[0-9a-fA-F]+)/)[1];

    console.log(`  InstitutionRegistry:  ${irAddress}`);
    console.log(`  CertificateRegistry:  ${crAddress}`);
    console.log(`  DigitalCredential:    ${dcAddress}`);

    const irContract = new ethers.Contract(irAddress, irAbi, provider);
    const crContract = new ethers.Contract(crAddress, crAbi, provider);
    const dcContract = new ethers.Contract(dcAddress, dcAbi, provider);

    // 2. Canonical On-Chain Institution Audit
    console.log('\n[2. CANONICAL ON-CHAIN INSTITUTION STATE]');
    const onChainInstIds = await irContract.getAllInstitutionIds();
    console.log(`  On-Chain Registered Institution IDs:`, onChainInstIds);

    const expectedCanonicalIds = ['DEMO_INST_01', 'UNIV01', 'INST-001'];
    
    if (onChainInstIds.length !== 3) {
        throw new Error(`MISMATCH: Expected exactly 3 canonical institutions on-chain, found ${onChainInstIds.length}: ${JSON.stringify(onChainInstIds)}`);
    }

    for (const expectedId of expectedCanonicalIds) {
        if (!onChainInstIds.includes(expectedId)) {
            throw new Error(`MISMATCH: Expected canonical institution ${expectedId} not found in on-chain registry!`);
        }
    }

    // Verify INST-002 is NOT registered in baseline state
    let inst2Exists = false;
    try {
        const inst2 = await irContract.getInstitution('INST-002');
        inst2Exists = Boolean(inst2 && (inst2[4] ?? inst2.exists));
    } catch (e) {
        inst2Exists = false;
    }

    if (inst2Exists) {
        throw new Error(`CONTAMINATION DETECTED: INST-002 is registered in baseline on-chain state!`);
    }
    console.log('  -> Baseline state is CLEAN: INST-002 is NOT registered on-chain.');

    // 3. Backend API Verification
    console.log('\n[3. BACKEND API RECONCILIATION]');
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    const apiSummary = await (await fetch('http://localhost:3000/api/analytics/summary', { headers: authHeaders })).json();
    console.log('  Backend /api/analytics/summary response:', apiSummary);
    if (apiSummary.totalInstitutions !== 3) {
        throw new Error(`MISMATCH: Backend reported totalInstitutions = ${apiSummary.totalInstitutions}, expected 3`);
    }

    const apiInsts = await (await fetch('http://localhost:3000/api/analytics/institutions', { headers: authHeaders })).json();
    console.log('  Backend /api/analytics/institutions response:', apiInsts);
    if (apiInsts.length !== 3) {
        throw new Error(`MISMATCH: Backend institution breakdown length = ${apiInsts.length}, expected 3`);
    }

    // 4. Controlled Issuance, Versioning & Revocation
    console.log('\n[4. CONTROLLED CANONICAL LIFECYCLE TEST]');
    const devKeys = {
        'DEMO_INST_01': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        'UNIV01': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        'INST-001': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        'INST-002': '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
    };

    const getInst1Signer = () => new ethers.Wallet(devKeys['DEMO_INST_01'], provider);
    const getInst2Signer = () => new ethers.Wallet(devKeys['INST-002'], provider);
    const getDeployerSigner = () => new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);

    async function getDirectNonce(address) {
        const raw = await provider.send('eth_getTransactionCount', [address, 'latest']);
        return parseInt(raw, 16);
    }

    const testCertId = `CERT-CANONICAL-${Date.now()}`;
    const testDocHash = ethers.keccak256(ethers.toUtf8Bytes(`Canonical Document Content ${Date.now()}`));

    console.log(`  Issuing ${testCertId} under DEMO_INST_01...`);
    const inst1Signer = getInst1Signer();
    const issueNonce = await getDirectNonce(inst1Signer.address);
    const issueTx = await dcContract.connect(inst1Signer).issueCertificate('DEMO_INST_01', testCertId, testDocHash, 0, { nonce: issueNonce });
    const issueReceipt = await issueTx.wait();
    console.log(`  -> Confirmed in block ${issueReceipt.blockNumber} (tx: ${issueReceipt.hash})`);

    const afterIssueCert = await crContract.getCertificate(testCertId);
    console.log(`  On-Chain Status: ${afterIssueCert[5]} (0=ACTIVE), Version: ${afterIssueCert[6]}`);
    if (Number(afterIssueCert[5]) !== 0 || Number(afterIssueCert[6]) !== 1) {
        throw new Error('Issuance verification failed on-chain!');
    }

    // 5. Cross-Institution Security Test (Dynamic Fixture Creation)
    console.log('\n[5. CROSS-INSTITUTION ADVERSARIAL SECURITY TEST]');
    console.log('  Dynamically creating temporary security fixture INST-002 on-chain...');

    // Register INST-002 dynamically in test
    const deployerSigner = getDeployerSigner();
    const inst2Signer = getInst2Signer();
    const depNonce = await getDirectNonce(deployerSigner.address);
    const regInst2Tx = await irContract.connect(deployerSigner).registerInstitution('INST-002', 'Polytechnic Institute Fixture', inst2Signer.address, { nonce: depNonce });
    await regInst2Tx.wait();

    const inst2AuthNonce = await getDirectNonce(inst2Signer.address);
    const authInst2Tx = await irContract.connect(inst2Signer).authorizeIssuer('INST-002', inst2Signer.address, { nonce: inst2AuthNonce });
    await authInst2Tx.wait();
    console.log(`  -> INST-002 dynamically registered and authorized with wallet ${inst2Signer.address}`);

    // Attack 1: INST-002 attempts to revoke DEMO_INST_01's certificate
    console.log('  ATTACK 1: INST-002 attempts to revoke DEMO_INST_01 certificate...');
    let attack1Blocked = false;
    try {
        const attack1Nonce = await getDirectNonce(inst2Signer.address);
        await dcContract.connect(inst2Signer).revokeCertificate('INST-002', testCertId, { nonce: attack1Nonce });
    } catch (err) {
        attack1Blocked = true;
        console.log(`  -> ATTACK 1 BLOCKED AS EXPECTED (Reverted with: ${err.reason || err.shortMessage || err.message})`);
    }
    if (!attack1Blocked) {
        throw new Error('CRITICAL SECURITY VULNERABILITY: INST-002 was able to revoke DEMO_INST_01 certificate!');
    }

    // Attack 2: INST-002 attempts to create Version 2 for DEMO_INST_01's certificate
    console.log('  ATTACK 2: INST-002 attempts to create new version for DEMO_INST_01 certificate...');
    let attack2Blocked = false;
    try {
        const fakeHash = ethers.keccak256(ethers.toUtf8Bytes('Malicious Version'));
        const attack2Nonce = await getDirectNonce(inst2Signer.address);
        await dcContract.connect(inst2Signer).createNewVersion('INST-002', testCertId, fakeHash, 0, { nonce: attack2Nonce });
    } catch (err) {
        attack2Blocked = true;
        console.log(`  -> ATTACK 2 BLOCKED AS EXPECTED (Reverted with: ${err.reason || err.shortMessage || err.message})`);
    }
    if (!attack2Blocked) {
        throw new Error('CRITICAL SECURITY VULNERABILITY: INST-002 was able to create version on DEMO_INST_01 certificate!');
    }

    // Legitimate Operation: DEMO_INST_01 creates Version 2 and then Revokes
    console.log('\n  Legitimate Operation: DEMO_INST_01 creates Version 2...');
    const v2Hash = ethers.keccak256(ethers.toUtf8Bytes(`Valid Version 2 ${Date.now()}`));
    const v2Nonce = await getDirectNonce(inst1Signer.address);
    const v2Tx = await dcContract.connect(inst1Signer).createNewVersion('DEMO_INST_01', testCertId, v2Hash, 0, { nonce: v2Nonce });
    await v2Tx.wait();
    console.log('  -> Version 2 created successfully by authorized institution.');

    console.log('  Legitimate Operation: DEMO_INST_01 revokes certificate...');
    const revokeNonce = await getDirectNonce(inst1Signer.address);
    const revokeTx = await dcContract.connect(inst1Signer).revokeCertificate('DEMO_INST_01', testCertId, { nonce: revokeNonce });
    await revokeTx.wait();
    console.log('  -> Certificate revoked successfully by authorized institution.');

    const finalCertState = await crContract.getCertificate(testCertId);
    console.log(`  Final On-Chain Certificate Status: ${finalCertState[5]} (1=REVOKED), Version: ${finalCertState[6]}`);
    if (Number(finalCertState[5]) !== 1 || Number(finalCertState[6]) !== 2) {
        throw new Error('Final state verification failed!');
    }

    console.log('\n================================================================================');
    console.log('CLEAN CANONICAL ARCHITECTURE & SECURITY AUDIT PASSED 100%');
    console.log('================================================================================');
}

runCleanCanonicalAudit().catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
});
