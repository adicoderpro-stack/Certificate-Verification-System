import { ethers } from "ethers";
import DigitalCredentialABI from "../contracts/DigitalCredential.json";
import InstitutionRegistryABI from "../contracts/InstitutionRegistry.json";

// Configured addresses with sensible fallback defaults (Sepolia deployed addresses)
export const CONTRACT_ADDRESSES = {
  institutionRegistry: import.meta.env.VITE_INSTITUTION_REGISTRY_ADDRESS || "0x74d706a420986021C52f5FcD78BbDF0e6D16bc8b",
  digitalCredential: import.meta.env.VITE_DIGITAL_CREDENTIAL_ADDRESS || "0xd0f9074613351AE06f9b852Ac1aD30A59d927C66"
};

// Safe public Sepolia RPC fallback for read-only / public operations without wallet connection
const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
// VITE_RPC_URL takes priority (used for local Hardhat). VITE_SEPOLIA_RPC_URL is the Sepolia override.
export const RPC_ENDPOINT = import.meta.env.VITE_RPC_URL || import.meta.env.VITE_SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC;

export function getInjectedEthereumProvider() {
  if (typeof window === "undefined") return null;

  if (window.ethereum) {
    if (Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
      const metaMask = window.ethereum.providers.find(p => p.isMetaMask);
      if (metaMask) return metaMask;
      return window.ethereum.providers[0];
    }
    return window.ethereum;
  }

  return null;
}

class BlockchainService {
  constructor() {
    this.readProvider = new ethers.JsonRpcProvider(RPC_ENDPOINT);
    this.provider = this.readProvider;
    this.signer = null;

    this.digitalCredential = new ethers.Contract(
      CONTRACT_ADDRESSES.digitalCredential,
      DigitalCredentialABI.abi,
      this.readProvider
    );
    this.institutionRegistry = new ethers.Contract(
      CONTRACT_ADDRESSES.institutionRegistry,
      InstitutionRegistryABI.abi,
      this.readProvider
    );
  }

  getReadContract() {
    return this.digitalCredential || new ethers.Contract(
      CONTRACT_ADDRESSES.digitalCredential,
      DigitalCredentialABI.abi,
      this.readProvider || this.provider
    );
  }

  getReadInstitutionContract() {
    return this.institutionRegistry || new ethers.Contract(
      CONTRACT_ADDRESSES.institutionRegistry,
      InstitutionRegistryABI.abi,
      this.readProvider || this.provider
    );
  }

  async connectWallet() {
    const ethereum = getInjectedEthereumProvider();
    if (!ethereum) {
      throw new Error("No Web3 wallet extension detected. Please install MetaMask to connect your wallet.");
    }

    try {
      await ethereum.request({ method: "eth_requestAccounts" });
    } catch (err) {
      if (err && (err.code === 4001 || err.code === 'ACTION_REJECTED' || (err.message && err.message.includes('rejected')))) {
        throw new Error("Wallet connection request was rejected in MetaMask.");
      }
      throw new Error(err.message || "Failed to request accounts from wallet.");
    }

    this.provider = new ethers.BrowserProvider(ethereum);
    this.signer = await this.provider.getSigner();

    this.digitalCredential = new ethers.Contract(
      CONTRACT_ADDRESSES.digitalCredential,
      DigitalCredentialABI.abi,
      this.signer
    );

    this.institutionRegistry = new ethers.Contract(
      CONTRACT_ADDRESSES.institutionRegistry,
      InstitutionRegistryABI.abi,
      this.signer
    );

    const address = await this.signer.getAddress();

    let netName = "Unknown Network";
    try {
      const chainIdHex = await ethereum.request({ method: 'eth_chainId' });
      const chainId = parseInt(chainIdHex, 16);

      if (chainId === 11155111) {
        netName = "Ethereum Sepolia";
      } else if (chainId === 31337) {
        netName = "Hardhat Local";
      } else if (chainId === 1) {
        netName = "Mainnet";
      } else if (chainId === 1337 || chainId === 1338) {
        netName = "Localhost";
      } else {
        const network = await this.provider.getNetwork();
        netName = network.name === "unknown" ? `Chain ${chainId}` : network.name;
      }
    } catch (e) {
      const network = await this.provider.getNetwork();
      netName = network.name === "unknown" ? "Ethereum Sepolia" : network.name;
    }

    return {
      address,
      network: netName
    };
  }

  getWalletAddress() {
    if (!this.signer) return null;
    return this.signer.getAddress();
  }

  // --- Institution operations ---
  async registerInstitution(id, name, wallet) {
    if (!this.signer) throw new Error("MetaMask wallet is not connected");
    const contract = this.institutionRegistry.connect(this.signer);
    const tx = await contract.registerInstitution(id, name, wallet);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const cached = JSON.parse(localStorage.getItem('credchain_registered_institutions') || '[]');
        if (!cached.includes(id)) {
          cached.push(id);
          localStorage.setItem('credchain_registered_institutions', JSON.stringify(cached));
        }
      }
    } catch (e) { }
    return tx;
  }

  async authorizeIssuer(instId, issuerWallet) {
    if (!this.signer) throw new Error("MetaMask wallet is not connected");
    const contract = this.institutionRegistry.connect(this.signer);
    return await contract.authorizeIssuer(instId, issuerWallet);
  }

  async getInstitution(instId) {
    const contract = this.getReadInstitutionContract();
    return await contract.getInstitution(instId);
  }

  async getAllRegisteredInstitutions() {
    const candidateIds = new Set();
    const contract = this.getReadInstitutionContract();

    // 1. Authoritative On-Chain Enumeration directly from the InstitutionRegistry smart contract
    try {
      if (typeof contract.getAllInstitutionIds === 'function') {
        const onChainIds = await contract.getAllInstitutionIds();
        if (Array.isArray(onChainIds)) {
          onChainIds.forEach(id => { if (id && typeof id === 'string') candidateIds.add(id); });
        }
      }
    } catch (e) { }

    // 2. Discover from optional off-chain backend if configured
    const API_URL = import.meta.env.VITE_API_URL;
    if (API_URL) {
      try {
        const res = await fetch(`${API_URL}/api/certificates`);
        if (res.ok) {
          const certs = await res.json();
          certs.forEach(c => {
            if (c.institutionId && !c.institutionId.startsWith('0x')) {
              candidateIds.add(c.institutionId);
            }
          });
        }
      } catch (e) { }
    }

    // 3. Fallback to localStorage cache
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const cached = JSON.parse(localStorage.getItem('credchain_registered_institutions') || '[]');
        cached.forEach(id => { if (id) candidateIds.add(id); });
      }
    } catch (e) { }

    const list = [];
    for (const instId of candidateIds) {
      try {
        const inst = await contract.getInstitution(instId);
        const exists = Boolean(inst && (inst[4] ?? inst.exists));
        if (exists) {
          const isActive = Boolean(inst[3] ?? inst.isActive);
          list.push({
            id: String(inst[0] || instId),
            name: String(inst[1] || inst.name || instId),
            wallet: String(inst[2] || inst.institutionWallet || inst.wallet || ''),
            isActive,
            exists: true
          });
        }
      } catch (err) { }
    }

    return list;
  }

  async getAllAuthorizedIssuers() {
    const institutions = await this.getAllRegisteredInstitutions();
    const contract = this.getReadInstitutionContract();
    const candidateWallets = new Set();

    institutions.forEach(inst => {
      if (inst.wallet && inst.wallet !== '0x0000000000000000000000000000000000000000' && inst.wallet !== '0x000') {
        candidateWallets.add(inst.wallet);
      }
    });

    try {
      const authEvents = await contract.queryFilter(contract.filters.IssuerAuthorized(), 0, "latest");
      authEvents.forEach(e => {
        if (e.args && e.args[1]) candidateWallets.add(e.args[1]);
      });
    } catch (e) { }

    const issuersList = [];
    for (const inst of institutions) {
      for (const wallet of candidateWallets) {
        try {
          const isAuth = await contract.isAuthorizedIssuer(inst.id, wallet);
          const isPrimary = inst.wallet && inst.wallet.toLowerCase() === wallet.toLowerCase();
          if (isAuth || isPrimary) {
            issuersList.push({
              instId: inst.id,
              instName: inst.name,
              wallet: wallet,
              status: 'AUTHORIZED',
              isPrimary
            });
          }
        } catch (e) { }
      }
    }
    return issuersList;
  }

  async isAuthorizedIssuer(instId, issuerWallet) {
    const contract = this.getReadInstitutionContract();

    try {
      const inst = await contract.getInstitution(instId);
      if (!inst || !inst.exists || !inst.isActive) {
        return { isAuthorized: false, reason: `Institution "${instId}" does not exist or is inactive.` };
      }

      const isAuth = await contract.isAuthorizedIssuer(instId, issuerWallet);
      const isPrimaryWallet = inst.wallet && inst.wallet.toLowerCase() === issuerWallet.toLowerCase();

      if (isAuth || isPrimaryWallet) {
        return { isAuthorized: true, institution: inst, isPrimary: isPrimaryWallet };
      }

      return {
        isAuthorized: false,
        reason: `Wallet ${issuerWallet.substring(0, 6)}...${issuerWallet.substring(38)} is not an authorized issuer for ${inst.name} (${instId}).`
      };
    } catch (err) {
      return { isAuthorized: false, reason: err.reason || err.message || "Failed to query institution contract authorization." };
    }
  }

  // --- Certificate operations ---
  async issueCertificate(instId, certId, hash, expiry) {
    if (!this.signer) throw new Error("MetaMask wallet is not connected");
    const contract = this.digitalCredential.connect(this.signer);
    return await contract.issueCertificate(instId, certId, hash, expiry);
  }

  // Pure on-chain read: Works WITHOUT requiring wallet connection!
  async verifyCertificate(certId, hash) {
    const contract = this.getReadContract();
    return await contract.verifyCertificate(certId, hash);
  }

  // Pure on-chain read: Works WITHOUT requiring wallet connection!
  async getCertificate(certId) {
    const contract = this.getReadContract();
    return await contract.getCertificate(certId);
  }

  async getCertificateVersion(certId, version) {
    const contract = this.getReadContract();
    return await contract.getCertificateVersion(certId, version);
  }

  async getCertificateVersionCount(certId) {
    const contract = this.getReadContract();
    return await contract.getCertificateVersionCount(certId);
  }

  async getCredentials() {
    const discoveredIds = new Set();
    const contract = this.getReadContract();

    // 1. Authoritative On-Chain Enumeration from CertificateRegistry
    try {
      if (typeof contract.getAllCertificateIds === 'function') {
        const onChainIds = await contract.getAllCertificateIds();
        if (Array.isArray(onChainIds)) {
          onChainIds.forEach(id => { if (id && typeof id === 'string') discoveredIds.add(id); });
        }
      }
    } catch (e) { }

    // 2. Off-chain database certificates (if configured)
    let certList = [];
    const API_URL = import.meta.env.VITE_API_URL;
    if (API_URL) {
      try {
        const res = await fetch(`${API_URL}/api/certificates`);
        if (res.ok) {
          certList = await res.json();
          certList.forEach(c => { if (c.id && !c.id.startsWith('0x')) discoveredIds.add(c.id); });
        }
      } catch (e) { }
    }

    const enriched = [];
    const nowSec = Math.floor(Date.now() / 1000);

    for (const certId of discoveredIds) {
      try {
        const onChain = await contract.getCertificate(certId);
        if (onChain && (onChain[7] ?? onChain.exists)) {
          const issueTimestamp = Number(onChain[3] ?? onChain.issueTimestamp ?? 0);
          const expiryTimestamp = Number(onChain[4] ?? onChain.expiryTimestamp ?? 0);
          const statusNum = Number(onChain[5] ?? onChain.status ?? 0);
          const versionNum = Number(onChain[6] ?? onChain.version ?? 1);
          const meta = certList.find(c => c.id === certId) || {};
          const isExpired = expiryTimestamp > 0 && nowSec > expiryTimestamp;

          enriched.push({
            certId: String(onChain[0] || certId),
            issuer: String(onChain[2] || onChain.issuer || '0x000'),
            issueTimestamp,
            expiryTimestamp,
            status: statusNum === 1 ? 'REVOKED' : (isExpired ? 'EXPIRED' : 'ACTIVE'),
            isExpired,
            version: versionNum,
            institutionId: String(onChain[8] || onChain.institutionId || meta.institutionId || ''),
            hash: String(onChain[1] || onChain.certificateHash || '')
          });
        }
      } catch (err) { }
    }

    return enriched;
  }

  // Event and credentials parsing for Dashboard & Lists
  async getAllEvents() {
    const [institutionsList, credentials] = await Promise.all([
      this.getAllRegisteredInstitutions(),
      this.getCredentials()
    ]);

    const activeInstitutionsCount = institutionsList.filter(i => i.isActive).length;

    const issued = credentials.map(c => ({
      certId: c.certId,
      issuer: c.issuer,
      timestamp: c.issueTimestamp,
      expiryTimestamp: c.expiryTimestamp,
      status: c.status,
      isExpired: c.isExpired,
      version: c.version,
      institutionId: c.institutionId
    }));

    const revoked = credentials.filter(c => c.status === 'REVOKED').map(c => ({
      certId: c.certId
    }));

    const expired = credentials.filter(c => c.status === 'EXPIRED').map(c => ({
      certId: c.certId
    }));

    return {
      issued,
      revoked,
      expired,
      institutions: activeInstitutionsCount
    };
  }

  async revokeCertificate(instId, certId) {
    if (!this.signer) throw new Error("MetaMask wallet is not connected");
    const contract = this.digitalCredential.connect(this.signer);
    return await contract.revokeCertificate(instId, certId);
  }

  async createNewVersion(instId, certId, newHash, newExpiry) {
    if (!this.signer) throw new Error("MetaMask wallet is not connected");
    const contract = this.digitalCredential.connect(this.signer);
    return await contract.createNewVersion(instId, certId, newHash, newExpiry);
  }
}

export const blockchainService = new BlockchainService();
