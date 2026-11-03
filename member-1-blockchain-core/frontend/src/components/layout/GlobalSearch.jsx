import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, FileText, Building2, Users, ArrowRight, ShieldCheck, Hash } from 'lucide-react';
import { Badge } from '../common/Components';
import { blockchainService } from '../../services/blockchain';

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState({ credentials: [], institutions: [], issuers: [], action: null });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Cmd+K or Ctrl+K shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search execution whenever query changes
  useEffect(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      setResults({ credentials: [], institutions: [], issuers: [], action: null });
      return;
    }

    // 1. Gather all local credentials
    let localCreds = [];
    try {
      const raw = localStorage.getItem('credchain_local_credentials');
      if (raw) {
        localCreds = Object.values(JSON.parse(raw));
      }
    } catch (e) {}

    // Default demo credentials if not yet issued
    const allCreds = [
      ...localCreds,
      {
        certId: 'CERT-2026-672901',
        studentName: 'Alice Johnson',
        courseName: 'B.S. Computer Science & Cybersecurity',
        institutionId: 'DEMO_INST_01',
        status: 'ACTIVE',
        hash: '0x328b9c6475a34e0a7f1c93a027376c6696eaebf5e9332e6504bdfd9426f4f134'
      }
    ];

    // Filter unique credentials by certId
    const seenCreds = new Set();
    const matchedCreds = allCreds.filter(c => {
      if (!c.certId || seenCreds.has(c.certId)) return false;
      seenCreds.add(c.certId);
      const idMatch = c.certId.toLowerCase().includes(trimmed);
      const nameMatch = (c.studentName || '').toLowerCase().includes(trimmed);
      const courseMatch = (c.courseName || '').toLowerCase().includes(trimmed);
      const hashMatch = (c.hash || '').toLowerCase().includes(trimmed);
      return idMatch || nameMatch || courseMatch || hashMatch;
    }).slice(0, 5);

    // 2. Gather institutions
    let customInsts = [];
    try {
      const raw = localStorage.getItem('credchain_custom_institutions');
      if (raw) customInsts = Object.values(JSON.parse(raw));
    } catch(e) {}

    const allInsts = [
      { id: 'DEMO_INST_01', name: 'Global Tech University', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isActive: true },
      ...customInsts
    ];

    const seenInsts = new Set();
    const matchedInsts = allInsts.filter(inst => {
      if (!inst.id || seenInsts.has(inst.id)) return false;
      seenInsts.add(inst.id);
      const idMatch = inst.id.toLowerCase().includes(trimmed);
      const nameMatch = (inst.name || '').toLowerCase().includes(trimmed);
      const walletMatch = (inst.wallet || '').toLowerCase().includes(trimmed);
      return idMatch || nameMatch || walletMatch;
    }).slice(0, 3);

    // 3. Gather issuers
    let customIssuers = [];
    try {
      const raw = localStorage.getItem('credchain_custom_issuers');
      if (raw) customIssuers = JSON.parse(raw);
    } catch(e) {}

    const allIssuers = [
      { instId: 'DEMO_INST_01', wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', status: 'AUTHORIZED' },
      ...customIssuers
    ];

    const seenIssuers = new Set();
    const matchedIssuers = allIssuers.filter(iss => {
      const key = `${iss.instId}-${iss.wallet}`;
      if (seenIssuers.has(key)) return false;
      seenIssuers.add(key);
      const walletMatch = (iss.wallet || '').toLowerCase().includes(trimmed);
      const instMatch = (iss.instId || '').toLowerCase().includes(trimmed);
      return walletMatch || instMatch;
    }).slice(0, 3);

    // 4. Default quick action: Verify on blockchain
    const action = {
      label: `Verify "${query.trim()}" on Blockchain`,
      url: `/verify?id=${encodeURIComponent(query.trim())}`
    };

    setResults({
      credentials: matchedCreds,
      institutions: matchedInsts,
      issuers: matchedIssuers,
      action
    });
    setSelectedIndex(0);
  }, [query]);

  // Flattened items for keyboard navigation
  const allItems = [
    ...results.credentials.map(c => ({ type: 'credential', data: c })),
    ...results.institutions.map(i => ({ type: 'institution', data: i })),
    ...results.issuers.map(is => ({ type: 'issuer', data: is })),
    ...(results.action ? [{ type: 'action', data: results.action }] : [])
  ];

  const handleSelect = (item) => {
    setIsOpen(false);
    setQuery('');
    if (item.type === 'credential') {
      navigate(`/credentials/${encodeURIComponent(item.data.certId)}`);
    } else if (item.type === 'institution') {
      navigate('/institutions');
    } else if (item.type === 'issuer') {
      navigate('/issuers');
    } else if (item.type === 'action') {
      navigate(item.data.url);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || allItems.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        setIsOpen(false);
        navigate(`/verify?id=${encodeURIComponent(query.trim())}`);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % allItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + allItems.length) % allItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems[selectedIndex]) {
        handleSelect(allItems[selectedIndex]);
      } else {
        navigate(`/verify?id=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const hasAnyResults = results.credentials.length > 0 || results.institutions.length > 0 || results.issuers.length > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '360px', maxWidth: '100%' }}>
      {/* Search Input Box */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-main)',
          padding: '0.45rem 0.75rem',
          borderRadius: 'var(--radius-md)',
          border: isOpen ? '1px solid var(--primary)' : '1px solid var(--border)',
          boxShadow: isOpen ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'none',
          transition: 'all 0.15s ease',
          boxSizing: 'border-box'
        }}
      >
        <Search size={15} style={{ marginRight: '0.6rem', color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search credentials, hashes, issuers..."
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-main)',
            fontSize: '0.85rem',
            width: '100%',
            fontFamily: 'inherit'
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd
            style={{
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.1rem 0.35rem',
              fontFamily: 'var(--font-mono, monospace)',
              flexShrink: 0,
              userSelect: 'none'
            }}
          >
            ⌘K
          </kbd>
        )}
      </div>

      {/* Floating Results Dropdown */}
      {isOpen && query.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '460px',
            maxWidth: '90vw',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
            zIndex: 1000,
            maxHeight: '440px',
            overflowY: 'auto',
            padding: '0.5rem 0'
          }}
        >
          {/* Credentials Section */}
          {results.credentials.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  padding: '0.4rem 1rem 0.25rem 1rem',
                  letterSpacing: '0.05em'
                }}
              >
                Credentials ({results.credentials.length})
              </div>
              {results.credentials.map((cred) => {
                const itemIndex = allItems.findIndex(i => i.type === 'credential' && i.data.certId === cred.certId);
                const isSelected = itemIndex === selectedIndex;
                return (
                  <div
                    key={cred.certId}
                    onClick={() => handleSelect({ type: 'credential', data: cred })}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.6rem 1rem',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-main)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                      transition: 'background 0.1s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <FileText size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="mono">{cred.certId}</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>•</span>
                          <span style={{ color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {cred.studentName}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {cred.courseName}
                        </div>
                      </div>
                    </div>
                    <Badge type={cred.status === 'ACTIVE' ? 'success' : 'danger'} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', flexShrink: 0 }}>
                      {cred.status || 'ACTIVE'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Institutions Section */}
          {results.institutions.length > 0 && (
            <div style={{ borderTop: results.credentials.length > 0 ? '1px solid var(--border)' : 'none', marginTop: results.credentials.length > 0 ? '0.35rem' : 0, paddingTop: '0.25rem' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  padding: '0.4rem 1rem 0.25rem 1rem',
                  letterSpacing: '0.05em'
                }}
              >
                Institutions ({results.institutions.length})
              </div>
              {results.institutions.map((inst) => {
                const itemIndex = allItems.findIndex(i => i.type === 'institution' && i.data.id === inst.id);
                const isSelected = itemIndex === selectedIndex;
                return (
                  <div
                    key={inst.id}
                    onClick={() => handleSelect({ type: 'institution', data: inst })}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.55rem 1rem',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-main)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Building2 size={16} color="var(--accent)" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{inst.name}</div>
                        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{inst.id}</div>
                      </div>
                    </div>
                    <Badge type="info" style={{ fontSize: '0.7rem' }}>ACCREDITED</Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Issuers Section */}
          {results.issuers.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.35rem', paddingTop: '0.25rem' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  padding: '0.4rem 1rem 0.25rem 1rem',
                  letterSpacing: '0.05em'
                }}
              >
                Authorized Issuers ({results.issuers.length})
              </div>
              {results.issuers.map((iss) => {
                const itemIndex = allItems.findIndex(i => i.type === 'issuer' && i.data.wallet === iss.wallet && i.data.instId === iss.instId);
                const isSelected = itemIndex === selectedIndex;
                return (
                  <div
                    key={`${iss.instId}-${iss.wallet}`}
                    onClick={() => handleSelect({ type: 'issuer', data: iss })}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.55rem 1rem',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-main)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Users size={16} color="var(--primary)" />
                      <div>
                        <div className="mono" style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                          {iss.wallet.substring(0, 10)}...{iss.wallet.substring(34)}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Institution: {iss.instId}</div>
                      </div>
                    </div>
                    <Badge type="success" style={{ fontSize: '0.7rem' }}>AUTHORIZED</Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick Action: Verify on blockchain */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.35rem', paddingTop: '0.25rem' }}>
            {(() => {
              const itemIndex = allItems.findIndex(i => i.type === 'action');
              const isSelected = itemIndex === selectedIndex;
              return (
                <div
                  onClick={() => handleSelect({ type: 'action', data: results.action })}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.6rem 1rem',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                    color: 'var(--primary)',
                    fontWeight: 500,
                    fontSize: '0.82rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <ShieldCheck size={16} />
                    <span>Verify &quot;{query.trim()}&quot; on Blockchain</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>Press Enter</span>
                    <ArrowRight size={13} />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
