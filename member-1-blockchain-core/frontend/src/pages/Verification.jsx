import React, { useState, useEffect } from 'react';
import { Card } from '../components/common/Components';
import { Search, CheckCircle, XCircle, AlertTriangle, Clock, Upload, FileText } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { blockchainService } from '../services/blockchain';

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

export default function Verification() {
  const [searchParams] = useSearchParams();
  const [certId, setCertId] = useState(searchParams.get('id') || searchParams.get('certId') || '');
  const [selectedFile, setSelectedFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

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
      if (['VALID', 'TAMPERED', 'REVOKED', 'EXPIRED'].includes(statusText) && resolvedCertId) {
        try {
          const cert = await blockchainService.getCertificate(resolvedCertId);
          if (cert && (cert[7] ?? cert.exists)) {
            version = (cert[6] ?? cert.version ?? 1).toString();
          }
        } catch (err) {
          console.warn("Could not fetch version details:", err);
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
          institutionId: 'DEMO_INST_01',
          issuer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          computedHash: computedHash || '',
          version: version || 1,
          ipAddress: '127.0.0.1 (Workspace Verification Engine)',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser Client'
        };
        const past = JSON.parse(localStorage.getItem('credchain_audit_verifications') || '[]');
        past.unshift(auditRecord);
        localStorage.setItem('credchain_audit_verifications', JSON.stringify(past.slice(0, 100)));
      } catch (e) {}

      setResult({
        status: statusText || 'NOT_FOUND',
        version: version,
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
        icon: <CheckCircle size={48} color="var(--success)" />,
        title: "Credential Verified",
        desc: "Blockchain proof matches the submitted credential exactly.",
        color: "var(--success)", bg: "var(--success-bg)"
      },
      TAMPERED: {
        icon: <AlertTriangle size={48} color="var(--warning)" />,
        title: "Integrity Check Failed",
        desc: "The submitted credential hash does not match the blockchain record.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      REVOKED: {
        icon: <XCircle size={48} color="var(--danger)" />,
        title: "Credential Revoked",
        desc: "This credential has been permanently revoked by an authorized issuer.",
        color: "var(--danger)", bg: "var(--danger-bg)"
      },
      EXPIRED: {
        icon: <Clock size={48} color="var(--warning)" />,
        title: "Credential Expired",
        desc: "This credential is no longer within its validity period.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      NOT_FOUND: {
        icon: <Search size={48} color="var(--text-muted)" />,
        title: "Credential Not Found",
        desc: "No trusted blockchain record exists for this credential.",
        color: "var(--text-muted)", bg: "var(--border-subtle)"
      },
      MANUAL_ID_REQUIRED: {
        icon: <AlertTriangle size={48} color="var(--warning)" />,
        title: "Credential ID Required",
        desc: result.message || "Credential ID could not be detected from this PDF. Please enter it manually in the input above.",
        color: "var(--warning)", bg: "var(--warning-bg)"
      },
      ERROR: {
        icon: <AlertTriangle size={48} color="var(--danger)" />,
        title: "Verification Error",
        desc: result.message || "Failed to complete verification.",
        color: "var(--danger)", bg: "var(--danger-bg)"
      }
    };

    const d = displays[result.status] || displays.NOT_FOUND;

    return (
      <div style={{marginTop: '2rem', padding: '2rem', borderRadius: 'var(--radius-lg)', background: d.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', border: `1px solid ${d.color}`}}>
        <div style={{marginBottom: '1rem'}}>{d.icon}</div>
        <h2 style={{color: d.color, margin: '0 0 0.5rem 0'}}>{d.title}</h2>
        <p style={{color: 'var(--text-main)', margin: 0, opacity: 0.9}}>{d.desc}</p>

        {result.status === "VALID" && (
          <div style={{marginTop: '2rem', width: '100%', maxWidth: '400px', background: 'var(--bg-card)', padding: '1.5rem', borderRadius: 'var(--radius-md)', textAlign: 'left'}}>
             <h4 style={{margin: '0 0 1rem 0', color: 'var(--text-muted)'}}>Trust Summary</h4>
             <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}><span>Blockchain Verified</span> <span style={{color: 'var(--success)', fontWeight: 'bold'}}>✓</span></div>
             <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}><span>Issuer Authorized</span> <span style={{color: 'var(--success)', fontWeight: 'bold'}}>✓</span></div>
             <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}><span>Hash Match</span> <span style={{color: 'var(--success)', fontWeight: 'bold'}}>✓</span></div>
             <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}><span>Credential Active</span> <span style={{color: 'var(--success)', fontWeight: 'bold'}}>✓</span></div>
             <div style={{display: 'flex', justifyContent: 'space-between'}}><span>Version</span> <span>{result.version}</span></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{maxWidth: '800px', margin: '0 auto'}}>
      <div className="page-header" style={{textAlign: 'center', marginBottom: '3rem'}}>
        <h1 className="page-title">Verify a Digital Credential</h1>
        <p className="page-subtitle">Confirm that a credential matches the trusted blockchain record deterministically.</p>
      </div>

      <Card>
        <form onSubmit={handleVerify}>
          <div className="form-group">
            <label className="form-label" style={{ fontWeight: 600 }}>Credential ID <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(Optional - Auto-detected from PDF)</span></label>
            <input className="form-input" placeholder="e.g. CERT-001 (Leave empty to auto-detect from QR)" value={certId} onChange={e => setCertId(e.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" style={{ fontWeight: 600 }}>Certificate PDF</label>
            <div style={{
              border: '2px dashed var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '1.5rem',
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
                    <FileText size={32} color="var(--primary)" />
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{selectedFile.name}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>({(selectedFile.size / 1024).toFixed(1)} KB) — Click to change file</span>
                  </>
                ) : (
                  <>
                    <Upload size={32} color="var(--text-muted)" />
                    <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Choose Certificate PDF</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Click to browse or drag and drop candidate PDF</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{width: '100%', marginTop: '1rem', padding: '0.8rem'}} disabled={loading}>
            {loading ? 'Verifying certificate...' : 'Verify Credential'}
          </button>
        </form>
      </Card>

      {getStatusDisplay()}
    </div>
  );
}
