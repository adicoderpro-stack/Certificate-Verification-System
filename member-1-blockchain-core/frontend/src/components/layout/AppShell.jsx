import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Building2,
  Users,
  Search,
  Activity,
  Settings as SettingsIcon,
  BarChart3,
  Copy,
  CheckCircle,
  Sun,
  Moon,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  Cpu
} from 'lucide-react';
import { Badge } from '../common/Components';
import { blockchainService } from '../../services/blockchain';
import GlobalSearch from './GlobalSearch';

function CredChainLogoMark({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="brand-logo-mark"
      aria-hidden="true"
    >
      {/* Upper-left credential anchor node */}
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {/* Lower-right verification block node */}
      <rect
        x="13.5"
        y="13.5"
        width="7"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {/* Cryptographic consensus link paths */}
      <path
        d="M7 10.5V14.25C7 15.49 8.01 16.5 9.25 16.5H13.5"
        stroke="var(--sidebar-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 13.5V9.75C17 8.51 15.99 7.5 14.75 7.5H10.5"
        stroke="var(--sidebar-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Micro-nodes */}
      <circle cx="7" cy="7" r="1.25" fill="var(--sidebar-accent)" />
      <circle cx="17" cy="17" r="1.25" fill="var(--sidebar-accent)" />
    </svg>
  );
}

export function Sidebar({ network }) {
  const [chainInfo, setChainInfo] = useState({
    name: network || 'Hardhat Local',
    chainId: 31337,
    status: 'connected'
  });

  useEffect(() => {
    let isMounted = true;
    async function fetchNetworkDetails() {
      try {
        if (blockchainService && blockchainService.provider) {
          const net = await blockchainService.provider.getNetwork();
          if (isMounted && net) {
            const id = Number(net.chainId);
            const friendlyName =
              id === 31337 ? 'Hardhat Local' :
              id === 11155111 ? 'Ethereum Sepolia' :
              id === 1 ? 'Ethereum Mainnet' :
              id === 1337 ? 'Local Geth' : (network || `Chain ${id}`);
            setChainInfo({
              name: network || friendlyName,
              chainId: id,
              status: 'connected'
            });
          }
        }
      } catch (err) {
        if (isMounted) {
          setChainInfo({
            name: network || 'Hardhat Local',
            chainId: 31337,
            status: 'connected'
          });
        }
      }
    }
    fetchNetworkDetails();
    return () => { isMounted = false; };
  }, [network]);

  const navGroups = [
    {
      group: "WORKSPACE",
      items: [
        { to: "/dashboard", icon: LayoutDashboard, label: "Overview" },
        { to: "/credentials", icon: FileText, label: "Credentials" },
        { to: "/verification", icon: Search, label: "Verification" }
      ]
    },
    {
      group: "INSTITUTIONS",
      items: [
        { to: "/institutions", icon: Building2, label: "Institutions" },
        { to: "/issuers", icon: Users, label: "Issuers" }
      ]
    },
    {
      group: "INTELLIGENCE",
      items: [
        { to: "/analytics", icon: BarChart3, label: "Analytics" },
        { to: "/activity", icon: Activity, label: "Audit Trail" }
      ]
    },
    {
      group: "SYSTEM",
      items: [
        { to: "/tech-stack", icon: Cpu, label: "Tech Stack" },
        { to: "/settings", icon: SettingsIcon, label: "Settings" }
      ]
    }
  ];

  return (
    <aside className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-header">
        <div className="brand-lockup">
          <div className="brand-icon-wrapper">
            <CredChainLogoMark size={20} />
          </div>
          <div className="brand-text-block">
            <span className="brand-title">CredChain</span>
            <span className="brand-badge">PROTOCOL</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navGroups.map((section, sIdx) => (
          <div key={section.group || sIdx} className="nav-section">
            <div className="nav-section-title">{section.group}</div>
            <div className="nav-section-items">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <item.icon className="nav-icon" size={18} strokeWidth={1.8} />
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="network-status-widget">
          <div className="status-header">
            <span className="status-indicator"></span>
            <span className="status-title">{chainInfo.chainId === 11155111 ? 'Public Testnet' : 'Local EVM'}</span>
          </div>
          <div className="status-details">
            <span className="network-name">{chainInfo.name}</span>
            <span className="chain-pill">Chain {chainInfo.chainId}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function Header({ wallet, network, connect, theme, toggleTheme }) {
  const [copied, setCopied] = React.useState(false);
  const [activeChain, setActiveChain] = React.useState({ name: network || 'Hardhat Local', chainId: 31337 });

  React.useEffect(() => {
    async function resolveNetwork() {
      try {
        if (blockchainService?.provider) {
          const net = await blockchainService.provider.getNetwork();
          const id = Number(net.chainId);
          const name =
            id === 31337 ? 'Hardhat Local' :
            id === 11155111 ? 'Ethereum Sepolia' :
            id === 1 ? 'Ethereum Mainnet' : `Chain ${id}`;
          setActiveChain({ name: network || name, chainId: id });
        }
      } catch(e) {}
    }
    resolveNetwork();
  }, [network]);

  const handleCopy = () => {
    if (wallet) {
      navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <GlobalSearch />
      </div>
      <div className="header-right">
        {/* Network Badge */}
        <Badge type={activeChain.chainId === 11155111 ? "primary" : "neutral"} style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}>
          {activeChain.name} ({activeChain.chainId})
        </Badge>

        {/* Web3 Signing Authority Indicator */}
        {wallet ? (
          <Badge type="success" style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }} title="Web3 cryptographic signer is active and ready.">
            <ShieldCheck size={13} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} /> Signer Active
          </Badge>
        ) : (
          <Badge type="info" style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }} title="Web3 cryptographic signing is ready. Connect MetaMask or use the institutional signer.">
            <Shield size={13} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} /> Web3 Signing Ready
          </Badge>
        )}

        {toggleTheme && (
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle-btn"
            aria-label={theme === 'dark' ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === 'dark' ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        )}
        {wallet ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
             <Badge type="success" style={{ fontSize: '0.75rem' }}>MetaMask</Badge>
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-main)', padding: '0.35rem 0.55rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
               <span className="mono" style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                 {wallet.substring(0,6)}...{wallet.substring(38)}
               </span>
               <button onClick={handleCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }} title="Copy wallet address">
                 {copied ? <CheckCircle size={13} color="var(--success)" /> : <Copy size={13} />}
               </button>
             </div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={connect} style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f97316', borderColor: '#f97316', fontWeight: 600 }} title="Connect MetaMask or Institutional Web3 Signer">
            <Wallet size={14} /> Connect Signer
          </button>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children, wallet, network, connect, theme, toggleTheme }) {
  return (
    <div className="app-shell">
      <Sidebar network={network} />
      <div className="main-wrapper">
        <Header wallet={wallet} network={network} connect={connect} theme={theme} toggleTheme={toggleTheme} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
