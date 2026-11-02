import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let provider;
let signer;
let digitalCredentialContract;
let certificateRegistryContract;
let institutionRegistryContract;

// Institutional Signer Accounts for Local Development / Hardhat Node
// Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 -> DEMO_INST_01, UNIV01, INST-001
// Account #2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC -> INST-002
// Account #3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906 -> INST-003
const DEV_INSTITUTION_KEYS = {
    'DEMO_INST_01': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    'UNIV01': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    'INST-001': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    'INST-002': '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    'INST-003': '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
};

const DEFAULT_INST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // Account #1

export async function connectBlockchain() {
    provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
    signer = new ethers.Wallet(process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);

    // Load self-contained ABIs directly from local contracts directory
    const contractsDir = fileURLToPath(new URL('../contracts', import.meta.url));

    function loadAbi(filename) {
        const filePath = path.join(contractsDir, filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('ABI file not found: ' + filePath);
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.abi || !Array.isArray(data.abi)) {
            throw new Error('Invalid ABI format in ' + filename + ': missing abi array');
        }
        return data;
    }

    const dcData = loadAbi('DigitalCredential.json');
    const crData = loadAbi('CertificateRegistry.json');
    const irData = loadAbi('InstitutionRegistry.json');

    digitalCredentialContract = new ethers.Contract(
        process.env.DIGITAL_CREDENTIAL_ADDRESS,
        dcData.abi,
        signer
    );

    certificateRegistryContract = new ethers.Contract(
        process.env.CERTIFICATE_REGISTRY_ADDRESS,
        crData.abi,
        signer
    );

    const instRegAddress = process.env.INSTITUTION_REGISTRY_ADDRESS || await digitalCredentialContract.institutionRegistry();
    institutionRegistryContract = new ethers.Contract(
        instRegAddress,
        irData.abi,
        signer
    );
    
    console.log('Blockchain connected and contracts initialized.');

    // Ensure all development institutions are registered and authorized on-chain
    await ensureInstitutionalAuthorizations();
}

async function ensureInstitutionalAuthorizations() {
    try {
        console.log('Verifying on-chain institutional wallet authorizations...');
        const deployerSigner = new ethers.Wallet(process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
        const inst1Signer = new ethers.Wallet(DEFAULT_INST_KEY, provider); // Account #1
        const regContractDeployer = institutionRegistryContract.connect(deployerSigner);
        const regContractInst1 = institutionRegistryContract.connect(inst1Signer);

        let deployerNonce = await deployerSigner.getNonce('latest');
        let inst1Nonce = await inst1Signer.getNonce('latest');

        const devInstitutions = [
            { id: 'DEMO_INST_01', name: 'Global Tech University', wallet: inst1Signer.address },
            { id: 'UNIV01', name: 'State University', wallet: inst1Signer.address },
            { id: 'INST-001', name: 'Institute One', wallet: inst1Signer.address }
        ];

        for (const inst of devInstitutions) {
            let instExists = false;
            try {
                const existing = await institutionRegistryContract.getInstitution(inst.id);
                instExists = existing && (existing[4] ?? existing.exists);
            } catch (e) {}

            if (!instExists) {
                console.log(`Registering institution ${inst.id} on-chain...`);
                const tx = await regContractDeployer.registerInstitution(inst.id, inst.name, inst.wallet, { nonce: deployerNonce++ });
                await tx.wait();
            }

            // Ensure issuer wallet is authorized on-chain
            const isAuth = await institutionRegistryContract.isAuthorizedIssuer(inst.id, inst.wallet);
            if (!isAuth) {
                console.log(`Authorizing wallet ${inst.wallet} on-chain for ${inst.id}...`);
                const tx = await regContractInst1.authorizeIssuer(inst.id, inst.wallet, { nonce: inst1Nonce++ });
                await tx.wait();
            }
        }
        console.log('Institutional wallet authorizations verified on-chain.');
    } catch (err) {
        console.warn('Institutional auto-authorization warning (non-fatal):', err.message || err);
    }
}

export function getProvider() {
    return provider;
}

const institutionSignersCache = {};

export function getInstitutionSigner(institutionId) {
    if (!institutionId || typeof institutionId !== 'string' || !institutionId.trim()) {
        throw new Error('No blockchain signing identity configured for institution: undefined');
    }

    const rawId = institutionId.trim();
    const instKey = rawId.toUpperCase();

    if (!institutionSignersCache[instKey]) {
        // Look up explicit key in DEV_INSTITUTION_KEYS or environment
        const matchedKey = DEV_INSTITUTION_KEYS[rawId] ||
                           DEV_INSTITUTION_KEYS[instKey] ||
                           process.env[`INST_KEY_${instKey}`] ||
                           process.env[`INST_KEY_${rawId}`];

        if (!matchedKey) {
            throw new Error(`No blockchain signing identity configured for institution: ${rawId}`);
        }

        institutionSignersCache[instKey] = new ethers.Wallet(matchedKey, provider);
    }
    return institutionSignersCache[instKey];
}

export async function verifyInstitutionSignerOnChain(institutionId, signerAddress) {
    const rawId = (institutionId || '').trim();
    if (!rawId) {
        throw new Error('Institution ID is required');
    }

    try {
        const inst = await institutionRegistryContract.getInstitution(rawId);
        if (!inst.exists) {
            throw new Error(`Institution '${rawId}' is not registered on the blockchain.`);
        }
        if (!inst.isActive) {
            throw new Error(`Institution '${rawId}' is marked as inactive on-chain.`);
        }

        const registeredWallet = inst.wallet;
        const isAuthorized = await institutionRegistryContract.isAuthorizedIssuer(rawId, signerAddress);
        const isPrimaryWallet = (registeredWallet.toLowerCase() === signerAddress.toLowerCase());

        if (!isAuthorized && !isPrimaryWallet) {
            throw new Error(`Signer wallet ${signerAddress} is not authorized for institution '${rawId}'.`);
        }

        return {
            isValid: true,
            institution: {
                id: inst.id,
                name: inst.name,
                wallet: inst.wallet,
                isActive: inst.isActive
            },
            isPrimaryWallet,
            isAuthorizedIssuer: isAuthorized
        };
    } catch (err) {
        if (err.message && err.message.includes('revert')) {
            throw new Error(`Institution '${rawId}' does not exist on-chain or caller is unauthorized.`);
        }
        throw err;
    }
}

export function getDigitalCredentialContract() {
    return digitalCredentialContract;
}

export function getDigitalCredentialContractForInstitution(institutionId) {
    const instSigner = getInstitutionSigner(institutionId);
    return digitalCredentialContract.connect(instSigner);
}

export async function getLiveNonce(signerOrAddress) {
    const addr = typeof signerOrAddress === 'string' ? signerOrAddress : await signerOrAddress.getAddress();
    return await provider.getTransactionCount(addr, 'pending');
}

export function parseContractError(err) {
    if (!err) return 'Unknown error occurred';
    if (err.reason) return err.reason;
    if (err.shortMessage) return err.shortMessage;
    if (err.info && err.info.error && err.info.error.message) return err.info.error.message;
    if (err.message) return err.message;
    return String(err);
}

export function getCertificateRegistryContract() {
    return certificateRegistryContract;
}

export function getInstitutionRegistryContract() {
    return institutionRegistryContract;
}
