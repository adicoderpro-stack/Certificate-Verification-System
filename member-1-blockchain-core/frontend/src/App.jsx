import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Institutions from './pages/Institutions';
import Certificates from './pages/Certificates';
import BlockchainActivityPage from './pages/BlockchainActivityPage';
import PublicVerification from './pages/PublicVerification';
import CredentialDetails from './pages/CredentialDetails';
import Analytics from './pages/Analytics';
import Issuers from './pages/Issuers';
import Verification from './pages/Verification';
import TechnologyStack from './pages/TechnologyStack';
import Settings from './pages/Settings';
import BlockchainLoader from './components/common/BlockchainLoader';
import btcCoin from './assets/bitcoin-coin.jpg';
import { blockchainService, getInjectedEthereumProvider } from './services/blockchain';

import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

function App() {
  const [wallet, setWallet] = useState(null);
  const [network, setNetwork] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [isInitializing, setIsInitializing] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const connect = async () => {
    try {
      const data = await blockchainService.connectWallet();
      setWallet(data.address);
      setNetwork(data.network);
    } catch (err) {
      console.error('MetaMask wallet connection error:', err);
      alert(err.message || "Please install MetaMask (metamask.io) to connect your Web3 wallet.");
    }
  };

  useEffect(() => {
    const iv = setInterval(() => {
      setProgress(p => Math.min(p + 2, 100));
    }, 50);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const ethereum = getInjectedEthereumProvider();

    const init = async () => {
      if (ethereum && (ethereum.selectedAddress || (ethereum.accounts && ethereum.accounts.length > 0))) {
        try {
          await connect();
        } catch (e) {
          // silent fail for init
        }
      }
    };
    init();

    if (ethereum && ethereum.on) {
      const handleAccounts = () => connect();
      const handleChain = () => window.location.reload();

      ethereum.on('accountsChanged', handleAccounts);
      ethereum.on('chainChanged', handleChain);

      return () => {
        if (ethereum.removeListener) {
          ethereum.removeListener('accountsChanged', handleAccounts);
          ethereum.removeListener('chainChanged', handleChain);
        }
      };
    }
  }, []);

  if (isInitializing) {
    return (
      <BlockchainLoader
        progress={progress}
        onComplete={() => setIsInitializing(false)}
        coinSrc={btcCoin}
        size={380}
      />
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/verify" element={<PublicVerification theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/*" element={
          <AppShell wallet={wallet} network={network} connect={connect} theme={theme} toggleTheme={toggleTheme}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/institutions" element={<Institutions />} />
              <Route path="/credentials" element={<Certificates />} />
              <Route path="/credentials/:id" element={<CredentialDetails />} />
              <Route path="/activity" element={<BlockchainActivityPage />} />
              <Route path="/issuers" element={<Issuers />} />
              <Route path="/verification" element={<Verification />} />
              <Route path="/tech-stack" element={<TechnologyStack />} />
              <Route path="/settings" element={<Settings network={network} />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </AppShell>
        } />
      </Routes>
    </Router>
  );
}

export default App;

