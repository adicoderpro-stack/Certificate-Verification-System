import jsPDF from 'jspdf';
import QRCode from 'qrcode';

/**
 * Generates a professional certificate PDF with embedded QR code,
 * finalizes PDF bytes, and computes deterministic SHA-256 hash.
 */
export async function generateCertificatePDF({
  studentName,
  courseName,
  certId,
  institutionId,
  institutionName = "Global Tech University",
  issueDate = new Date().toISOString().split('T')[0],
  expiryDate = "No Expiry",
  verifyUrl
}) {
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_VERIFY_URL)
    || (typeof window !== 'undefined' ? window.location.origin : '');
  const targetUrl = verifyUrl || `${baseUrl}/verify?id=${encodeURIComponent(certId)}`;

  // 1. Generate QR Code image as Data URL
  const qrDataUrl = await QRCode.toDataURL(targetUrl, {
    margin: 1,
    width: 200,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });

  // 2. Create jsPDF document (A4 Landscape: 297mm x 210mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const width = 297;
  const height = 210;

  // Background / Margins
  doc.setFillColor(250, 250, 252);
  doc.rect(0, 0, width, height, 'F');

  // Outer Decorative Border
  doc.setLineWidth(1.5);
  doc.setDrawColor(30, 41, 59); // Deep Slate
  doc.rect(10, 10, width - 20, height - 20);

  // Inner Accent Border
  doc.setLineWidth(0.5);
  doc.setDrawColor(59, 130, 246); // Primary Blue
  doc.rect(13, 13, width - 26, height - 26);

  // Top Banner / Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(59, 130, 246);
  doc.text("CREDCHAIN BLOCKCHAIN-BACKED CREDENTIAL", width / 2, 28, { align: "center" });

  doc.setFontSize(26);
  doc.setTextColor(15, 23, 42);
  doc.text(institutionName.toUpperCase(), width / 2, 42, { align: "center" });

  doc.setLineWidth(0.5);
  doc.setDrawColor(226, 232, 240);
  doc.line(60, 48, width - 60, 48);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text("This is to certify that", width / 2, 58, { align: "center" });

  // Student Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(15, 23, 42);
  doc.text(studentName, width / 2, 72, { align: "center" });

  // Course completion text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(100, 116, 139);
  doc.text("has successfully completed the program and fulfilled all academic requirements for", width / 2, 84, { align: "center" });

  // Course / Degree Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 58, 138);
  doc.text(courseName, width / 2, 96, { align: "center" });

  // Details Grid Section
  doc.setLineWidth(0.3);
  doc.setDrawColor(226, 232, 240);
  doc.line(30, 110, width - 30, 110);

  // Metadata Left Box
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Credential Identifier:", 35, 125);
  doc.setFont("courier", "normal");
  doc.text(certId, 35, 131);

  doc.setFont("helvetica", "bold");
  doc.text("Institution ID:", 35, 143);
  doc.setFont("helvetica", "normal");
  doc.text(institutionId, 35, 149);

  doc.setFont("helvetica", "bold");
  doc.text("Date of Issuance:", 115, 125);
  doc.setFont("helvetica", "normal");
  doc.text(issueDate, 115, 131);

  doc.setFont("helvetica", "bold");
  doc.text("Expiration Date:", 115, 143);
  doc.setFont("helvetica", "normal");
  doc.text(expiryDate, 115, 149);

  // Embed QR Code (Right Box)
  doc.addImage(qrDataUrl, 'PNG', width - 75, 118, 35, 35);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Scan QR Code to Verify", width - 57.5, 157, { align: "center" });
  doc.text("On-Chain Authenticity", width - 57.5, 161, { align: "center" });

  // Bottom Footer
  doc.setLineWidth(0.3);
  doc.setDrawColor(226, 232, 240);
  doc.line(30, 172, width - 30, 172);

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Secured by CredChain Hybrid Ledger • Immutable Hash Verified • ID: ${certId}`, width / 2, 182, { align: "center" });

  // 3. Finalize PDF Bytes & Output ArrayBuffer
  const pdfArrayBuffer = doc.output('arraybuffer');
  const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });

  // 4. Compute Deterministic SHA-256 Hash of exact PDF bytes
  const hashBuffer = await crypto.subtle.digest('SHA-256', pdfArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const docHash = "0x" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    pdfBlob,
    pdfArrayBuffer,
    docHash,
    certId,
    verifyUrl: targetUrl
  };
}
