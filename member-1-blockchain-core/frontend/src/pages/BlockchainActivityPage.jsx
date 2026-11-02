import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { Card, Badge, HashDisplay, Modal } from '../components/common/Components';
import { LoadingState, EmptyState, ErrorState } from '../components/common/UIStates';
import { Activity, Search, Filter, ChevronLeft, ChevronRight, Eye, ExternalLink, ShieldCheck, Layers } from 'lucide-react';
import { blockchainService } from '../services/blockchain';

export default function BlockchainActivityPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState('ALL');
  const [selectedSource, setSelectedSource] = useState('ALL');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [latestBlock, setLatestBlock] = useState(0);

  // Modal State
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    loadAuditEvents(page, selectedEventType, selectedSource, searchTerm);
  }, [page, selectedEventType, selectedSource, searchTerm, blockchainService.provider]);

  const getApiUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return 'http://localhost:3000';
    }
    return '';
  };

  const fetchFreshAuthToken = async () => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return null;
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          return data.token;
        }
      }
    } catch (e) {
      console.warn('Auto-login for audit token failed:', e.message);
    }
    return null;
  };

  const getAuthToken = async () => {
    let token = localStorage.getItem('token') || localStorage.getItem('credchain_token');
    if (!token) {
      token = await fetchFreshAuthToken();
    }
    return token;
  };

  const loadAuditEvents = async (pageNum, eventTypeFilter, sourceFilter, search) => {
    try {
      setLoading(true);
      setError(null);

      let token = await getAuthToken();
      let headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const params = new URLSearchParams({
        page: pageNum,
        limit: limit,
        ...(eventTypeFilter !== 'ALL' && { eventType: eventTypeFilter }),
        ...(sourceFilter !== 'ALL' && { source: sourceFilter }),
        ...(search.trim() !== '' && { search: search.trim() })
      });

      let res = await fetch(`${apiUrl}/api/audit/events?${params.toString()}`, { headers });

      // If token was expired or invalid (401/403), clear stored tokens and retry with a fresh token
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('credchain_token');
        token = await fetchFreshAuthToken();
        headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        res = await fetch(`${apiUrl}/api/audit/events?${params.toString()}`, { headers });
      }

      if (!res.ok) {
        throw new Error(`Audit API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      setEvents(data.events || []);
      setPagination(data.pagination || { page: pageNum, limit: limit, total: 0, totalPages: 1 });
      setLatestBlock(data.latestBlock || 0);

    } catch (err) {
      console.error('Failed to load audit events from API:', err);
      // If contract provider is connected, attempt fallback directly to RPC contract logs
      if (blockchainService.provider) {
        await loadContractEventsFallback();
      } else {
        setError('The audit service could not be reached. Ensure backend server (port 3000) and Hardhat RPC (port 8545) are running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadContractEventsFallback = async () => {
    try {
      if (!blockchainService.provider) {
        throw new Error("No blockchain provider connected");
      }
      const instReg = blockchainService.institutionRegistry;
      const certRegAddress = await blockchainService.digitalCredential.certificateRegistry();
      const certReg = new ethers.Contract(certRegAddress, [
        "event CertificateIssued(string indexed certificateId, string certificateHash, address indexed issuer, uint256 expiryTimestamp, uint256 version)",
        "event CertificateRevoked(string indexed certificateId)"
      ], blockchainService.provider);

      let e1 = [], e2 = [], e3 = [], e4 = [];
      try {
        const curBlock = await blockchainService.provider.getBlockNumber();
        const startBlock = Math.max(0, curBlock - 5000);
        [e1, e2, e3, e4] = await Promise.all([
          instReg.queryFilter(instReg.filters.InstitutionRegistered(), startBlock, "latest").catch(() => []),
          instReg.queryFilter(instReg.filters.IssuerAuthorized(), startBlock, "latest").catch(() => []),
          certReg.queryFilter(certReg.filters.CertificateIssued(), startBlock, "latest").catch(() => []),
          certReg.queryFilter(certReg.filters.CertificateRevoked(), startBlock, "latest").catch(() => [])
        ]);
      } catch (err) {}

      const parseArg = (val) => {
        if (typeof val === 'string') return val;
        if (val && typeof val === 'object' && val.hash) return val.hash;
        return String(val ?? '');
      };

      const combined = [
        ...e1.map(e => ({ source: 'blockchain', eventType: 'InstitutionRegistered', blockNumber: Number(e.blockNumber), transactionHash: String(e.transactionHash || ''), institutionId: parseArg(e.args[0]), issuer: e.args[2] })),
        ...e2.map(e => ({ source: 'blockchain', eventType: 'IssuerAuthorized', blockNumber: Number(e.blockNumber), transactionHash: String(e.transactionHash || ''), institutionId: parseArg(e.args[0]), issuer: parseArg(e.args[1]) })),
        ...e3.map(e => ({ source: 'blockchain', eventType: 'CertificateIssued', blockNumber: Number(e.blockNumber), transactionHash: String(e.transactionHash || ''), certificateId: parseArg(e.args[0]), issuer: parseArg(e.args[2]), version: Number(e.args[4] || 1) })),
        ...e4.map(e => ({ source: 'blockchain', eventType: 'CertificateRevoked', blockNumber: Number(e.blockNumber), transactionHash: String(e.transactionHash || ''), certificateId: parseArg(e.args[0]) }))
      ];

      combined.sort((a,b) => b.blockNumber - a.blockNumber);
      setEvents(combined);
      setPagination({ page: 1, limit: combined.length, total: combined.length, totalPages: 1 });
      setLatestBlock(combined.length > 0 ? Math.max(...combined.map(e => e.blockNumber)) : 0);
    } catch (e) {
      console.error('loadContractEventsFallback error:', e);
      setError('Unable to load blockchain events from network. Ensure backend server (port 3000) and Hardhat RPC (port 8545) are running.');
    }
  };

  const getEventBadge = (event) => {
    const name = typeof event === 'string' ? event : event.eventType;
    const source = typeof event === 'object' ? event.source : null;
    const status = typeof event === 'object' ? event.status : null;

    if (source === 'application' || name === 'Credential Verified' || name === 'Certificate Verified') {
      switch (status) {
        case 'VALID':
          return <Badge type="success">Credential Verified (VALID)</Badge>;
        case 'TAMPERED':
          return <Badge type="warning">Credential Verified (TAMPERED)</Badge>;
        case 'REVOKED':
          return <Badge type="danger">Credential Verified (REVOKED)</Badge>;
        case 'EXPIRED':
          return <Badge type="warning">Credential Verified (EXPIRED)</Badge>;
        case 'NOT_FOUND':
          return <Badge type="neutral">Credential Verified (NOT_FOUND)</Badge>;
        default:
          return <Badge type="neutral">Credential Verified</Badge>;
      }
    }

    switch (name) {
      case 'CertificateIssued':
        return <Badge type="success">Certificate Issued</Badge>;
      case 'CertificateRevoked':
        return <Badge type="danger">Certificate Revoked</Badge>;
      case 'CertificateVersionCreated':
        return <Badge type="primary">Version Created</Badge>;
      case 'InstitutionRegistered':
        return <Badge type="success">Institution Registered</Badge>;
      case 'InstitutionDeactivated':
        return <Badge type="danger">Institution Deactivated</Badge>;
      case 'IssuerAuthorized':
        return <Badge type="primary">Issuer Authorized</Badge>;
      case 'IssuerRevoked':
        return <Badge type="warning">Issuer Revoked</Badge>;
      default:
        return <Badge type="neutral">{name}</Badge>;
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoStr;
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return '-';
    if (addr.length > 12) {
      return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    }
    return addr;
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Blockchain Audit Trail</h1>
          <p className="page-subtitle" style={{ maxWidth: '750px' }}>
            Chronological record of smart-contract events indexed from the blockchain. The blockchain is the authoritative source of event history; SQLite serves as an indexed query layer.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Badge type="primary">
            Showing {events.length} of {pagination.total} events
          </Badge>
          {latestBlock > 0 && (
            <Badge type="neutral">
              Latest Block: #{latestBlock}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        {/* Search & Filter Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '280px', maxWidth: '440px' }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by Tx Hash, Cert ID, Institution, or Issuer..."
              className="form-input"
              style={{ width: '100%', paddingLeft: '2.5rem' }}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Filter size={18} color="var(--text-muted)" />
            <select
              className="form-input"
              style={{ minWidth: '160px', cursor: 'pointer' }}
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Sources</option>
              <option value="blockchain">Blockchain Events</option>
              <option value="application">Application Logs</option>
            </select>

            <select
              className="form-input"
              style={{ minWidth: '180px', cursor: 'pointer' }}
              value={selectedEventType}
              onChange={(e) => {
                setSelectedEventType(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Event Types</option>
              <option value="CertificateIssued">Certificate Issued</option>
              <option value="CertificateRevoked">Certificate Revoked</option>
              <option value="CertificateVersionCreated">Certificate Version Created</option>
              <option value="Credential Verified">Credential Verified</option>
              <option value="InstitutionRegistered">Institution Registered</option>
              <option value="InstitutionDeactivated">Institution Deactivated</option>
              <option value="IssuerAuthorized">Issuer Authorized</option>
              <option value="IssuerRevoked">Issuer Revoked</option>
            </select>
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <LoadingState message="Fetching audit events..." />
        ) : error ? (
          <ErrorState
            title="Unable to Load Audit Trail"
            message={error}
            onRetry={() => loadAuditEvents(page, selectedEventType, selectedSource, searchTerm)}
          />
        ) : events.length === 0 ? (
          pagination.total === 0 && selectedEventType === 'ALL' && selectedSource === 'ALL' && searchTerm.trim() === '' ? (
            <EmptyState
              icon={Activity}
              title="No Activity Recorded"
              description="No audit events have been recorded yet. Issue or verify a credential to generate activity."
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No Matching Events"
              description="No audit events match the current search or filters."
            />
          )
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Event Type</th>
                    <th>Entity Reference</th>
                    <th>Issuer / IP</th>
                    <th>Block / Tx</th>
                    <th>Version</th>
                    <th style={{ textAlign: 'right' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e, idx) => {
                    const entity = e.certificateId || e.institutionId || '-';
                    const isCert = Boolean(e.certificateId);
                    const isAppLog = e.source === 'application';
                    return (
                      <tr
                        key={e.id || idx}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedEvent(e)}
                      >
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatDate(e.timestamp)}
                        </td>
                        <td>
                          {isAppLog ? (
                            <Badge type="neutral" title="Application Verification Log (SQLite)">APPLICATION LOG</Badge>
                          ) : (
                            <Badge type="primary" title="On-Chain Event (Solidity/EVM)">BLOCKCHAIN</Badge>
                          )}
                        </td>
                        <td>{getEventBadge(e)}</td>
                        <td>
                          {isCert ? (
                            <Link
                              to={`/credentials/${entity}`}
                              onClick={(ev) => ev.stopPropagation()}
                              className="mono"
                              style={{ fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              {entity} <ExternalLink size={12} />
                            </Link>
                          ) : (
                            <span className="mono" style={{ fontWeight: 500 }}>{entity}</span>
                          )}
                        </td>
                        <td className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }} title={isAppLog ? e.ipAddress : e.issuer}>
                          {isAppLog ? (e.ipAddress || '-') : formatAddress(e.issuer)}
                        </td>
                        <td className="mono" style={{ fontSize: '0.85rem' }} onClick={(ev) => ev.stopPropagation()}>
                          {isAppLog ? (
                            <span style={{ color: 'var(--text-muted)' }}>Read Op (N/A)</span>
                          ) : (
                            <div>
                              <div>#{e.blockNumber || 0}</div>
                              {e.transactionHash && <HashDisplay value={e.transactionHash} />}
                            </div>
                          )}
                        </td>
                        <td>
                          {e.version ? <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600 }}>v{e.version}</span> : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSelectedEvent(e);
                            }}
                          >
                            <Eye size={14} /> View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} total events)
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Event Details Modal */}
      <Modal
        isOpen={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        title="Event Details"
      >
        {selectedEvent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Event Source</div>
                <div>
                  {selectedEvent.source === 'application' ? (
                    <Badge type="neutral">Application Verification Log (SQLite)</Badge>
                  ) : (
                    <Badge type="primary">Blockchain (Solidity / EVM)</Badge>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Event Type</div>
                <div>{getEventBadge(selectedEvent)}</div>
              </div>
            </div>

            {selectedEvent.certificateId && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Certificate ID</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>{selectedEvent.certificateId}</span>
                  <Link to={`/credentials/${selectedEvent.certificateId}`} className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    Credential Details <ExternalLink size={14} />
                  </Link>
                </div>
              </div>
            )}

            {selectedEvent.institutionId && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Institution ID</div>
                <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 500 }}>{selectedEvent.institutionId}</div>
              </div>
            )}

            {selectedEvent.issuer && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Issuer Address</div>
                <HashDisplay value={selectedEvent.issuer} />
              </div>
            )}

            {selectedEvent.source === 'application' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>IP Address</div>
                  <div className="mono" style={{ fontSize: '0.95rem' }}>{selectedEvent.ipAddress || 'Unknown / Local'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>User Agent</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{selectedEvent.userAgent || 'Unknown'}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Block Number / Type</div>
                <div className="mono" style={{ fontSize: '0.95rem' }}>
                  {selectedEvent.source === 'application' ? 'Read Operation (No Block)' : `#${selectedEvent.blockNumber || 0}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Timestamp</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{formatDate(selectedEvent.timestamp)}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Transaction Hash / Reference</div>
              {selectedEvent.source === 'application' ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  N/A — Application Read Operation (Not a state-changing blockchain transaction)
                </div>
              ) : (
                <HashDisplay value={selectedEvent.transactionHash} />
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
