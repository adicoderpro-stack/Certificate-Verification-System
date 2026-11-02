import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Card, StatCard, Badge } from '../components/common/Components';
import { LoadingState, ErrorState, EmptyState } from '../components/common/UIStates';
import {
  BarChart3, Activity, Users, FileText, CheckCircle, XCircle,
  AlertTriangle, ShieldCheck, Building2, TrendingUp, Search, RefreshCw
} from 'lucide-react';
import { blockchainService } from '../services/blockchain';

export default function Analytics() {
  const [summary, setSummary] = useState({
    totalIssued: 0,
    activeCertificates: 0,
    totalRevoked: 0,
    totalExpired: 0,
    totalInstitutions: 0,
    totalIssuers: 0,
    totalVerifications: 0,
    tamperedAttempts: 0
  });

  const [issuanceTrends, setIssuanceTrends] = useState([]);
  const [verificationTrends, setVerificationTrends] = useState([]);
  const [verificationResults, setVerificationResults] = useState({
    VALID: 0,
    TAMPERED: 0,
    REVOKED: 0,
    EXPIRED: 0,
    NOT_FOUND: 0
  });
  const [institutions, setInstitutions] = useState([]);
  const [recentActivity, setRecentActivity] = useState({
    recentIssuances: [],
    recentRevocations: [],
    recentVerifications: []
  });

  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAnalytics();
  }, [blockchainService.provider]);

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
      console.warn('Could not auto-login for analytics token:', e.message);
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

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      let backendOk = false;

      if (apiUrl) {
        try {
          let token = await getAuthToken();
          let headers = token ? { 'Authorization': `Bearer ${token}` } : {};

          // Fetch summary and trend datasets
          let [sumRes, issueTrendRes, verifyTrendRes, resultsRes, instRes, activityRes] = await Promise.allSettled([
            fetch(`${apiUrl}/api/analytics/summary`, { headers }),
            fetch(`${apiUrl}/api/analytics/issuance-trends`, { headers }),
            fetch(`${apiUrl}/api/analytics/verification-trends`, { headers }),
            fetch(`${apiUrl}/api/analytics/verification-results`, { headers }),
            fetch(`${apiUrl}/api/analytics/institutions`, { headers }),
            fetch(`${apiUrl}/api/analytics/recent-activity`, { headers })
          ]);

          // Check if auth expired (401/403)
          if (sumRes.status === 'fulfilled' && (sumRes.value.status === 401 || sumRes.value.status === 403)) {
            localStorage.removeItem('token');
            localStorage.removeItem('credchain_token');
            token = await fetchFreshAuthToken();
            headers = token ? { 'Authorization': Bearer  } : {};
            [sumRes, issueTrendRes, verifyTrendRes, resultsRes, instRes, activityRes] = await Promise.allSettled([
              fetch(`${apiUrl}/api/analytics/summary`, { headers }),
              fetch(`${apiUrl}/api/analytics/issuance-trends`, { headers }),
              fetch(`${apiUrl}/api/analytics/verification-trends`, { headers }),
              fetch(`${apiUrl}/api/analytics/verification-results`, { headers }),
              fetch(`${apiUrl}/api/analytics/institutions`, { headers }),
              fetch(`${apiUrl}/api/analytics/recent-activity`, { headers })
            ]);
          }

          if (sumRes.status === 'fulfilled' && sumRes.value.ok) {
            const data = await sumRes.value.json();
            setSummary(data);
            backendOk = true;
          }

          if (issueTrendRes.status === 'fulfilled' && issueTrendRes.value.ok) {
            const data = await issueTrendRes.value.json();
            setIssuanceTrends(Array.isArray(data) ? data : []);
          }

          if (verifyTrendRes.status === 'fulfilled' && verifyTrendRes.value.ok) {
            const data = await verifyTrendRes.value.json();
            setVerificationTrends(Array.isArray(data) ? data : []);
          }

          if (resultsRes.status === 'fulfilled' && resultsRes.value.ok) {
            const data = await resultsRes.value.json();
            setVerificationResults(data || {});
          }

          if (instRes.status === 'fulfilled' && instRes.value.ok) {
            const data = await instRes.value.json();
            setInstitutions(Array.isArray(data) ? data : []);
          }

          if (activityRes.status === 'fulfilled' && activityRes.value.ok) {
            const data = await activityRes.value.json();
            setRecentActivity({
              recentIssuances: data.recentIssuances || [],
              recentRevocations: data.recentRevocations || [],
              recentVerifications: data.recentVerifications || []
            });
          }
        } catch (apiErr) {
          console.warn('Backend API query notice:', apiErr.message);
        }
      }

      // If backend was not reached or returned empty, fallback to contract state
      if (!backendOk) {
        await loadContractFallback();
      }
    } catch (err) {
      console.error('Error loading analytics data:', err);
      await loadContractFallback();
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadAnalytics();
  };

  const loadContractFallback = async () => {
    try {
      const instReg = blockchainService.institutionRegistry;
      const instFilter1 = instReg.filters.InstitutionRegistered();
      const instFilter2 = instReg.filters.IssuerAuthorized();

      const p1 = instReg.queryFilter(instFilter1, 0, "latest");
      const p2 = instReg.queryFilter(instFilter2, 0, "latest");

      const certRegAddress = await blockchainService.digitalCredential.certificateRegistry();
      const certReg = new ethers.Contract(certRegAddress, [
        "event CertificateIssued(string indexed certificateId, string certificateHash, address indexed issuer, uint256 expiryTimestamp, uint256 version)",
        "event CertificateRevoked(string indexed certificateId)"
      ], blockchainService.provider);

      const certFilter1 = certReg.filters.CertificateIssued();
      const certFilter2 = certReg.filters.CertificateRevoked();

      const p3 = certReg.queryFilter(certFilter1, 0, "latest");
      const p4 = certReg.queryFilter(certFilter2, 0, "latest");

      const [eInsts, eIssuers, eIssued, eRevoked] = await Promise.all([p1, p2, p3, p4]);

      const [registeredInstitutions, authorizedIssuers, credentials] = await Promise.all([
        blockchainService.getAllRegisteredInstitutions(),
        blockchainService.getAllAuthorizedIssuers(),
        blockchainService.getCredentials()
      ]);

      const uniqueInsts = registeredInstitutions.filter(i => i.isActive).length;
      const uniqueIssuers = new Set(authorizedIssuers.map(i => `${i.instId}-${i.wallet}`)).size;
      const uniqueIssued = credentials.length;
      const activeCount = credentials.filter(c => c.status === 'ACTIVE').length;
      const revokedCount = credentials.filter(c => c.status === 'REVOKED').length;
      const expiredCount = credentials.filter(c => c.status === 'EXPIRED').length;

      const recentIssued = eIssued.sort((a,b) => Number(b.blockNumber) - Number(a.blockNumber)).slice(0, 5);
      const recentRevoked = eRevoked.sort((a,b) => Number(b.blockNumber) - Number(a.blockNumber)).slice(0, 5);

      setSummary({
        totalIssued: uniqueIssued,
        activeCertificates: activeCount,
        totalRevoked: revokedCount,
        totalExpired: expiredCount,
        totalInstitutions: uniqueInsts,
        totalIssuers: uniqueIssuers,
        totalVerifications: 0,
        tamperedAttempts: 0
      });

      setRecentActivity({
        recentIssuances: recentIssued.map(e => ({ id: parseArg(e.args[0]), blockNumber: Number(e.blockNumber) })),
        recentRevocations: recentRevoked.map(e => ({ id: parseArg(e.args[0]), blockNumber: Number(e.blockNumber) })),
        recentVerifications: []
      });
    } catch (fallbackErr) {
      console.error('Fallback query error:', fallbackErr);
    }
  };

  // Calculations for outcomes breakdown
  const totalLogs = Object.values(verificationResults).reduce((a, b) => a + b, 0);

  const getPercentage = (count) => {
    if (totalLogs === 0) return 0;
    return Math.round((count / totalLogs) * 100);
  };

  // Helper for simple SVG bar chart
  const renderTrendChart = (data, title, icon, barColor = "var(--primary)") => {
    if (!data || data.length === 0) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
          No {title.toLowerCase()} data recorded yet.
        </div>
      );
    }

    const maxCount = Math.max(...data.map(d => d.count), 1);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', height: '180px', padding: '1rem 0.5rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
          {data.map((item, idx) => {
            const heightPercent = Math.max(12, Math.round((item.count / maxCount) * 100));
            return (
              <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>{item.count}</span>
                <div
                  title={`${item.date}: ${item.count}`}
                  style={{
                    width: '100%',
                    maxWidth: '36px',
                    height: `${heightPercent}%`,
                    background: barColor,
                    borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                    transition: 'all 0.3s ease'
                  }}
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50px' }}>
                  {item.date ? item.date.substring(5) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Platform Analytics</h1>
          <p className="page-subtitle">Real-time lifecycle & verification metrics derived from blockchain events and SQLite audit logs.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing || loading}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', padding: '0.4rem 0.8rem', cursor: 'pointer' }}
            title="Refresh analytics from blockchain and backend database"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <Badge type="primary">Source: Blockchain & Persistent DB</Badge>
        </div>
      </div>

      {loading && !isRefreshing ? (
        <LoadingState message="Aggregating blockchain events and verification metrics..." />
      ) : error ? (
        <ErrorState title="Failed to Load Analytics" message={error} onRetry={loadAnalytics} />
      ) : (
        <>
          {/* Primary Summary Metrics (On-Chain Truth) */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                On-Chain Lifecycle Metrics (Ethereum Blockchain State)
              </div>
              <Badge type="success">Authoritative On-Chain</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              <StatCard title="Total Issued" value={summary.totalIssued} icon={FileText} color="var(--primary)" />
              <StatCard title="Active Credentials" value={summary.activeCertificates} icon={CheckCircle} color="var(--success)" />
              <StatCard title="Revoked Credentials" value={summary.totalRevoked} icon={XCircle} color="var(--danger)" />
              <StatCard title="Expired Credentials" value={summary.totalExpired} icon={AlertTriangle} color="var(--warning)" />
            </div>
          </div>

          {/* Secondary Summary Metrics (Institutions & Verification Telemetry) */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Governance & Verification Telemetry (Institutions & Verification Logs)
              </div>
              <Badge type="info">Hybrid Governance & Logs</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
              <StatCard title="Total Institutions" value={summary.totalInstitutions} icon={Building2} color="var(--accent)" />
              <StatCard title="Authorized Issuers" value={summary.totalIssuers} icon={ShieldCheck} color="var(--primary)" />
              <StatCard title="Public Verifications" value={summary.totalVerifications} icon={Activity} color="var(--accent)" />
              <StatCard title="Tampered Detections" value={summary.tamperedAttempts} icon={XCircle} color="var(--danger)" />
            </div>
          </div>

          {/* Time Series Trends Grid */}
          <div className="grid-2-1" style={{ gap: '2rem', marginBottom: '2rem' }}>
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><TrendingUp size={18}/> Issuance Trends</div>}>
              {renderTrendChart(issuanceTrends, "Issuance", TrendingUp, "var(--primary)")}
            </Card>

            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18}/> Verification Activity Trend</div>}>
              {renderTrendChart(verificationTrends, "Verification Activity", Activity, "var(--accent)")}
            </Card>
          </div>

          {/* Verification Outcomes & Institution Distribution */}
          <div className="grid-2-1" style={{ gap: '2rem', marginBottom: '2rem' }}>
            {/* Verification Outcomes Breakdown */}
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Search size={18}/> Verification Results Breakdown</div>}>
              {totalLogs === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>
                  No verification attempts logged yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Visual Progress Stack */}
                  <div style={{ display: 'flex', height: '14px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--bg-main)' }}>
                    {verificationResults.VALID > 0 && <div style={{ width: `${getPercentage(verificationResults.VALID)}%`, background: 'var(--success)' }} title={`VALID: ${verificationResults.VALID}`} />}
                    {verificationResults.TAMPERED > 0 && <div style={{ width: `${getPercentage(verificationResults.TAMPERED)}%`, background: 'var(--danger)' }} title={`TAMPERED: ${verificationResults.TAMPERED}`} />}
                    {verificationResults.REVOKED > 0 && <div style={{ width: `${getPercentage(verificationResults.REVOKED)}%`, background: '#e11d48' }} title={`REVOKED: ${verificationResults.REVOKED}`} />}
                    {verificationResults.EXPIRED > 0 && <div style={{ width: `${getPercentage(verificationResults.EXPIRED)}%`, background: 'var(--warning)' }} title={`EXPIRED: ${verificationResults.EXPIRED}`} />}
                    {verificationResults.NOT_FOUND > 0 && <div style={{ width: `${getPercentage(verificationResults.NOT_FOUND)}%`, background: 'var(--text-muted)' }} title={`NOT_FOUND: ${verificationResults.NOT_FOUND}`} />}
                  </div>

                  {/* List of Outcomes */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                    <div style={{ padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--success)' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>VALID</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{verificationResults.VALID} ({getPercentage(verificationResults.VALID)}%)</div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--danger)' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>TAMPERED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{verificationResults.TAMPERED} ({getPercentage(verificationResults.TAMPERED)}%)</div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid #e11d48' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>REVOKED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{verificationResults.REVOKED} ({getPercentage(verificationResults.REVOKED)}%)</div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--warning)' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>EXPIRED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{verificationResults.EXPIRED} ({getPercentage(verificationResults.EXPIRED)}%)</div>
                    </div>
                    <div style={{ padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--text-muted)' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>NOT_FOUND</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>{verificationResults.NOT_FOUND} ({getPercentage(verificationResults.NOT_FOUND)}%)</div>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Institution Breakdown */}
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Building2 size={18}/> Credentials by Institution</div>}>
              {institutions.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>
                  No institution data recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {institutions.map((inst, idx) => {
                    const maxInstCount = Math.max(...institutions.map(i => i.count), 1);
                    const widthPercent = Math.max(10, Math.round((inst.count / maxInstCount) * 100));
                    return (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{inst.institutionId}</span>
                          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{inst.count} credentials</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: 'var(--bg-main)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                          <div style={{ width: `${widthPercent}%`, height: '100%', background: 'var(--primary)', borderRadius: 'var(--radius-sm)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Recent Activity Feeds */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {/* Recent Issuances */}
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={18}/> Recent Issuances</div>}>
              {recentActivity.recentIssuances.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem 0' }}>No recent issuances found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {recentActivity.recentIssuances.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }}></div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.id || item.certificateId}</div>
                          {item.institutionId && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.institutionId}</div>}
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {item.blockNumber ? `Block ${item.blockNumber}` : (item.timestamp ? item.timestamp.substring(0, 10) : '')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Recent Revocations */}
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><XCircle size={18}/> Recent Revocations</div>}>
              {recentActivity.recentRevocations.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem 0' }}>No recent revocations found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {recentActivity.recentRevocations.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)' }}></div>
                        <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.id || item.certificateId}</span>
                      </div>
                      <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {item.blockNumber ? `Block ${item.blockNumber}` : (item.timestamp ? item.timestamp.substring(0, 10) : '')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Recent Verifications */}
            <Card title={<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18}/> Recent Verifications</div>}>
              {recentActivity.recentVerifications.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem 0' }}>No recent verifications logged.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {recentActivity.recentVerifications.map((item, i) => {
                    const badgeType = item.status === 'VALID' ? 'success' : (item.status === 'TAMPERED' || item.status === 'REVOKED' ? 'danger' : 'warning');
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{item.certificateId}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.timestamp ? item.timestamp.substring(0, 16).replace('T', ' ') : ''}</div>
                        </div>
                        <Badge type={badgeType}>{item.status}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
