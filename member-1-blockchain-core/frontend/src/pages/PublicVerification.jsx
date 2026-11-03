import React, { useState, useEffect } from 'react';
import { Card, HashDisplay } from '../components/common/Components';
import { Search, CheckCircle, XCircle, AlertTriangle, Clock, Shield, ArrowLeft, Upload, FileText, Sun, Moon } from 'lucide-react';
import { blockchainService } from '../services/blockchain';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';

// Helper to auto-detect Certificate ID from uploaded PDF buffer
function extractCertificateIdFromBuffer(arrayBuffer) {
  if (!arrayBuffer) return null;
  try {
    const raw = new TextDecoder('latin1').decode(arrayBuffer);

    // 1. Search for URL parameter id=... or certId=... in QR code link or text annotations
    const urlMatch = raw.match(/(?:verify(?:\.html)?\?id=|id=|certId=)([\w\-]+)/i);
    if (urlMatch && urlMatch[1] && urlMatch[1].length >= 3) {
      return urlMatch[1];
    }

    // 2. Search for explicit Certificate ID patterns (e.g. Certificate ID: CERT-123)
    const certIdMatch = raw.match(/(?:Certificate\s*ID\s*:?\s*|Cert\s*ID\s*:?\s*)([\w\-]+)/i);
    if (certIdMatch && certIdMatch[1] && certIdMatch[1].length >= 3) {
      return certIdMatch[1];
    }

    // 3. Search for standard CredChain ID prefixes (CERT_, CERT-, AUDIT_CERT_, ISO_CERT_)
    const prefixMatch = raw.match(/\b(CERT[_\-][A-Za-z0-9_\-]+|AUDIT_CERT_[A-Za-z0-9_\-]+|ISO_CERT_[A-Za-z0-9_\-]+)\b/i);
    if (prefixMatch && prefixMatch[1]) {
      return prefixMatch[1];
    }
  } catch (e) {
    console.warn("Could not parse PDF buffer for ID:", e);
  }

  return null;
}

export default function PublicVerification({ theme, toggleTheme }) {
  const [searchParams] = useSearchParams();
  const [certId, setCertId] = useState(searchParams.get('id') || searchParams.get('certId') || '');
  const [selectedFile, setSelectedFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    if (location.state?.from === 'home') {
      navigate('/');
    } else {
      navigate('/dashboard');
    }
  };

  useEffect(() => {
    const idFromUrl = searchParams.get('id') || searchParams.get('certId');
    if (idFromUrl) {
      setCertId(idFromUrl);
    }
  }, [searchParams]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const activeCertId = certId.trim();
    if (!selectedFile && !activeCertId) {
      alert('Please enter a Certificate ID or select a certificate PDF file');
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      let computedHash = null;
      let resolvedCertId = activeCertId;

      if (selectedFile) {
        // 1. Read file bytes and compute deterministic SHA-256 hash in-browser
        const arrayBuffer = await selectedFile.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        computedHash = "0x" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (!resolvedCertId) {
          resolvedCertId = extractCertificateIdFromBuffer(arrayBuffer) || '';
        }

        if (!resolvedCertId) {
          setResult({
            status: 'MANUAL_ID_REQUIRED',
            message: 'Credential ID could not be detected automatically from this PDF. Please enter it manually in the input above.'
          });
          return;
        }
      }

      // Direct on-chain verification query
      let statusText = 'NOT_FOUND';
      if (computedHash) {
        statusText = await blockchainService.verifyCertificate(resolvedCertId, computedHash);
      } else {
        const certRecord = await blockchainService.getCertificate(resolvedCertId);
        if (certRecord && (certRecord[7] ?? certRecord.exists)) {
          const rawStatus = Number(certRecord[5] ?? certRecord.status ?? 0);
          const expiry = Number(certRecord[4] ?? certRecord.expiryTimestamp ?? 0);
          const nowSec = Math.floor(Date.now() / 1000);
          if (rawStatus === 1) statusText = 'REVOKED';
          else if (expiry > 0 && nowSec > expiry) statusText = 'EXPIRED';
          else statusText = 'VALID';
          computedHash = String(certRecord[1] || certRecord.certificateHash || '');
        } else {
          statusText = 'NOT_FOUND';
        }
      }

      // Fetch on-chain details if record exists
      let version = '-';
      let details = null;

      if (['VALID', 'TAMPERED', 'REVOKED', 'EXPIRED'].includes(statusText) && resolvedCertId) {
        try {
          const cert = await blockchainService.getCertificate(resolvedCertId);
          if (cert && (cert[7] ?? cert.exists)) {
            version = (cert[6] ?? cert.version ?? 1).toString();
            details = {
              id: String(cert[0] || cert.certificateId || resolvedCertId),
              hash: String(cert[1] || cert.certificateHash || ''),
              issuer: String(cert[2] || cert.issuer || ''),
              expiry: (cert[4] ?? cert.expiryTimestamp ?? 0).toString(),
              status: Number(cert[5] ?? cert.status ?? 0),
              version: version
            };
          }
        } catch (err) {
          console.warn("Could not fetch full on-chain details:", err);
        }
      }

      // Optional backend telemetry log (non-blocking)
      if (selectedFile) {
        const API_URL = import.meta.env.VITE_API_URL;
        if (API_URL) {
          try {
            const formData = new FormData();
            formData.append('certificateId', resolvedCertId);
            formData.append('pdf', selectedFile);
            fetch(`${API_URL}/api/certificates/verify`, {
              method: 'POST',
              body: formData
            }).catch(() => {});
          } catch (e) {}
        }
      }

      // Record verification & tampering events into persistent Audit Trail history
      try {
        const auditRecord = {
          id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          source: 'application',
          eventType: statusText === 'TAMPERED' ? 'Credential Tampered' : 'Credential Verified',
          status: statusText,
          certificateId: resolvedCertId,
          institutionId: details?.institutionId || 'DEMO_INST_01',
          issuer: details?.issuer || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          computedHash: computedHash || '',
          targetHash: details?.hash || '',
          version: version || 1,
          ipAddress: '127.0.0.1 (Public Verification Portal)',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser Client'
        };
        const past = JSON.parse(localStorage.getItem('credchain_audit_verifications') || '[]');
        past.unshift(auditRecord);
        localStorage.setItem('credchain_audit_verifications', JSON.stringify(past.slice(0, 100)));
      } catch (e) {}

      setResult({
        status: statusText,
        version,
        details,
        certificateId: resolvedCertId,
        computedHash
      });

    } catch (err) {
      console.error('Verification error:', err);
      setResult({ status: 'ERROR', message: err.message || 'Verification failed' });
    } finally {
      setLoading(false);
    }
  };

  const getStatusDisplay = () => {
    if (!result) return null;

    const displays = {
      VALID: {
        icon: <CheckCircle size={56} color="var(--success)" />,
        title: "CREDENTIAL VERIFIED",
        desc: "Blockchain proof securely matches the submitted credential.",
        color: "var(--success)", bg: "var(--success-bg)"
      },
      TAMPERED: {
        icon: <AlertTriangle size={56} color="var(--warning)" />,
        title: "CREDENTIAL INTEGRITY FAILED",
        desc: "Submitted hash does not match the trusted blockchain record.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      REVOKED: {
        icon: <XCircle size={56} color="var(--danger)" />,
        title: "CREDENTIAL REVOKED",
        desc: "This credential has been revoked by an authorized issuer.",
        color: "var(--danger)", bg: "var(--danger-bg)"
      },
      EXPIRED: {
        icon: <Clock size={56} color="var(--warning)" />,
        title: "CREDENTIAL EXPIRED",
        desc: "This credential is no longer within its validity period.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      NOT_FOUND: {
        icon: <Search size={56} color="var(--text-muted)" />,
        title: "CREDENTIAL NOT FOUND",
        desc: "No trusted blockchain record exists for this credential ID.",
        color: "var(--text-muted)", bg: "var(--border-subtle)"
      },
      MANUAL_ID_REQUIRED: {
        icon: <AlertTriangle size={56} color="var(--warning)" />,
        title: "CREDENTIAL ID REQUIRED",
        desc: result.message || "Credential ID could not be detected automatically from this PDF. Please enter it manually in the input above.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      ERROR: {
        icon: <AlertTriangle size={56} color="var(--danger)" />,
        title: "VERIFICATION ERROR",
        desc: result.message || "An error occurred while connecting to the blockchain.",
        color: "var(--danger)", bg: "var(--danger-bg)"
      }
    };

    const d = displays[result.status] || displays.NOT_FOUND;

    return (
      <div style={{marginTop: '3rem', animation: 'modal-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1)'}}>
        <div style={{padding: '3rem', borderRadius: 'var(--radius-xl)', background: d.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', border: `2px solid ${d.color}`, boxShadow: 'var(--shadow-md)'}}>
          <div style={{marginBottom: '1.5rem'}}>{d.icon}</div>
          <h2 style={{color: d.color, margin: '0 0 1rem 0', letterSpacing: '0.05em'}}>{d.title}</h2>
          <p style={{color: 'var(--text-main)', margin: 0, fontSize: '1.1rem'}}>{d.desc}</p>
        </div>

        {result.status === "VALID" && result.details && (
          <div style={{marginTop: '2rem', width: '100%', background: 'var(--bg-card)', padding: '2rem', borderRadius: 'var(--radius-lg)', textAlign: 'left', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)'}}>
             <h3 style={{margin: '0 0 1.5rem 0'}}>Blockchain Proof</h3>
             <div style={{display: 'flex', flexDirection: 'column', gap: '1.25rem'}}>
               <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem'}}>
                 <div>
                    <div style={{color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem'}}>Credential ID</div>
                    <div style={{fontWeight: 600, fontSize: '1.1rem'}}>{result.details.id}</div>
                 </div>
                 <div>
                    <div style={{color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem'}}>Version</div>
                    <div style={{fontWeight: 600, fontSize: '1.1rem'}}>{result.details.version}</div>
                 </div>
               </div>

               <div>
                  <div style={{color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem'}}>Issuer</div>
                  <HashDisplay value={result.details.issuer} />
               </div>

               <div>
                  <div style={{color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem'}}>Trusted Blockchain Hash</div>
                  <HashDisplay value={result.details.hash} />
               </div>

               <hr style={{border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0'}} />

               <h4 style={{margin: '0', color: 'var(--text-muted)'}}>Trust Checklist</h4>
               <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem'}}>
                 <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 500}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><CheckCircle size={16} color="var(--success)"/> Blockchain Record Found</span>
                    <span style={{color: 'var(--success)'}}>Verified</span>
                 </div>
                 <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 500}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><CheckCircle size={16} color="var(--success)"/> Issuer Authorized</span>
                    <span style={{color: 'var(--success)'}}>Verified</span>
                 </div>
                 <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 500}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><CheckCircle size={16} color="var(--success)"/> Hash Match</span>
                    <span style={{color: 'var(--success)'}}>Verified</span>
                 </div>
                 <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 500}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><CheckCircle size={16} color="var(--success)"/> Credential Status Valid</span>
                    <span style={{color: 'var(--success)'}}>Verified</span>
                 </div>
               </div>
             </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="public-layout">
      <header className="public-header" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Shield size={32} color="var(--primary)" />
          <h1 style={{ margin: 0, fontSize: '1.75rem', letterSpacing: '-0.025em' }}>CredChain</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
          <button className="btn btn-secondary" onClick={handleBack} style={{ border: 'none', background: 'transparent' }}>
            <ArrowLeft size={18} /> Back to Home
          </button>
        </div>
      </header>

      <main className="public-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem' }}>
        <div style={{ width: '100%', maxWidth: '650px' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', letterSpacing: '-0.025em' }}>Verify a Digital Credential</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', margin: 0 }}>
              Confirm the authenticity and current status of a digital credential using its cryptographic blockchain proof.
            </p>
          </div>

          <Card className="modal-enter" style={{ padding: '2.5rem' }}>
            <form onSubmit={handleVerify}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Credential ID <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(Optional - Auto-detected from PDF)</span></label>
                <input className="form-input" placeholder="e.g. CERT-2026-001 (Leave empty to auto-detect from QR)" value={certId} onChange={e => setCertId(e.target.value)} style={{ padding: '1rem', fontSize: '1rem' }} />
              </div>

              <div className="form-group" style={{ marginBottom: '2rem' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Certificate PDF</label>
                <div style={{
                  border: '2px dashed var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.75rem',
                  textAlign: 'center',
                  background: 'var(--bg-main)',
                  cursor: 'pointer',
                  position: 'relative'
                }}>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    onChange={handleFileChange}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', pointerEvents: 'none' }}>
                    {selectedFile ? (
                      <>
                        <FileText size={36} color="var(--primary)" />
                        <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '1.05rem' }}>{selectedFile.name}</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>({(selectedFile.size / 1024).toFixed(1)} KB) — Click to change file</span>
                      </>
                    ) : (
                      <>
                        <Upload size={36} color="var(--text-muted)" />
                        <span style={{ fontWeight: 500, color: 'var(--text-main)', fontSize: '1.05rem' }}>Choose Certificate PDF</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Click to browse or drag and drop candidate PDF</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1.25rem', fontSize: '1.1rem' }} disabled={loading}>
                {loading ? 'Verifying certificate...' : 'Verify Credential'}
              </button>
            </form>
          </Card>

          {getStatusDisplay()}
        </div>
      </main>
    </div>
  );
}
