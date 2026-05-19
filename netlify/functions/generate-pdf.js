const { jsPDF } = require('jspdf');
const JSZip = require('jszip');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    let rawBody = event.body || '';
    if (event.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
    if (!rawBody) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Empty body' }) };

    let data;
    try { data = JSON.parse(rawBody); }
    catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON parse failed: ' + e.message }) }; }

    if (!data.company || !data.address) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };

    const { company, address, postcode = '', elevations = [] } = data;
    const designer = data.designer || '—';
    const jobRef = data.job_ref || '—';
    const photoB64 = data.photo || null;
    const xlsxB64 = data.xlsx || null;

    const companyName = company.name || '';
    const parts = [company.addr1 || ''];
    if (company.addr2) parts.push(company.addr2);
    parts.push(`${company.city || ''}  ${company.postcode || ''}`);
    if (company.phone) parts.push(company.phone);
    const companyFull = parts.filter(Boolean).join(', ');

    let sheetImages = {};
    if (xlsxB64) {
      try { sheetImages = await extractImages(xlsxB64); }
      catch (e) { console.error('xlsx:', e.message); }
    }

    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    // A4 = 210 x 297mm
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, M = 15;
    const CW = PW - 2 * M;

    // ── COVER PAGE ──────────────────────────────────────────────────
    // White background (default)
    // Left slate bar
    doc.setFillColor(74, 85, 104);
    doc.rect(0, 0, 4, PH, 'F');
    // Bottom dark bar
    doc.setFillColor(45, 55, 72);
    doc.rect(0, PH - 13, PW, 13, 'F');
    // Company in bottom bar
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text(companyName, M, PH - 8);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 174, 192);
    doc.text(companyFull, M, PH - 3.5);

    let y = M;

    // Company name top
    doc.setTextColor(45, 55, 72);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text(companyName, M, y + 8);
    y += 12;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.setTextColor(113, 128, 150);
    doc.text(companyFull, M, y, { maxWidth: CW });
    y += 10;

    // Divider
    doc.setDrawColor(74, 85, 104); doc.setLineWidth(0.8);
    doc.line(M, y, PW - M, y);
    y += 6;

    // Property photo
    if (photoB64) {
      try {
        const imgData = photoB64;
        const ext = photoB64.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        const heroH = CW * 0.48;
        doc.addImage(imgData, ext, M, y, CW, heroH, undefined, 'FAST');
        y += heroH;
      } catch (e) {
        console.error('Photo error:', e.message);
        doc.setFillColor(237, 242, 247);
        doc.rect(M, y, CW, 50, 'F');
        y += 50;
      }
    } else {
      doc.setFillColor(237, 242, 247);
      doc.rect(M, y, CW, 50, 'F');
      doc.setTextColor(160, 174, 192); doc.setFontSize(10);
      doc.text('Property photo not provided', PW / 2, y + 27, { align: 'center' });
      y += 50;
    }

    // Title banner
    doc.setFillColor(45, 55, 72);
    doc.rect(M, y, CW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('EWI Thermal Bridging Design Document', M + 4, y + 13);
    y += 24;

    // Info table
    const infoRows = [
      ['Property Address:', `${address}, ${postcode}`],
      ['System Designer:', designer],
      ['Job Reference:', jobRef],
      ['Prepared by:', companyName],
      ['Date:', today],
    ];
    infoRows.forEach(([lbl, val], i) => {
      if (i % 2 === 0) { doc.setFillColor(237, 242, 247); doc.rect(M, y, CW, 8, 'F'); }
      doc.setFillColor(74, 85, 104); doc.rect(M + 52, y, 0.6, 8, 'F'); // vertical rule
      doc.setTextColor(45, 55, 72); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text(lbl, M + 2, y + 5.5);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(113, 128, 150);
      doc.text(val || '—', M + 55, y + 5.5, { maxWidth: CW - 57 });
      doc.setDrawColor(203, 213, 224); doc.setLineWidth(0.2);
      doc.line(M, y + 8, M + CW, y + 8);
      y += 8;
    });

    // ── ELEVATION PAGES ─────────────────────────────────────────────
    const ELEV_NAMES = ['Front Elevation', 'Back Elevation', 'Side Elevation 1', 'Side Elevation 2'];
    const ELEV_SHEETS = [0, 1, null, null];
    let pageNum = 1;

    for (let ei = 0; ei < ELEV_NAMES.length; ei++) {
      doc.addPage();
      pageNum++;

      // Header
      doc.setFillColor(45, 55, 72); doc.rect(0, 0, PW, 13, 'F');
      doc.setFillColor(74, 85, 104); doc.rect(0, 13, PW, 1.5, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text('EWI Thermal Bridging Design Document', M, 9);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 174, 192);
      doc.text(`${address}  |  ${postcode}`, PW - M, 9, { align: 'right' });

      // Footer
      doc.setDrawColor(203, 213, 224); doc.setLineWidth(0.3);
      doc.line(M, PH - 12, PW - M, PH - 12);
      doc.setTextColor(113, 128, 150); doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
      doc.text(companyName, M, PH - 8);
      doc.setFont('helvetica', 'normal');
      doc.text(companyFull, M, PH - 4, { maxWidth: CW - 20 });
      doc.text(`Page ${pageNum - 1}`, PW - M, PH - 8, { align: 'right' });

      let y2 = 18;

      // Section banner
      doc.setFillColor(45, 55, 72); doc.rect(M, y2, CW, 10, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(ELEV_NAMES[ei], M + 3, y2 + 7);
      y2 += 10;
      doc.setFillColor(74, 85, 104); doc.rect(M, y2, CW, 1.2, 'F');
      y2 += 5;

      // Photos from spreadsheet
      const photos = ELEV_SHEETS[ei] !== null ? (sheetImages[ELEV_SHEETS[ei]] || []) : [];
      if (photos.length > 0) {
        const n = Math.min(photos.length, 3), gap = 2;
        const pw = (CW - (n - 1) * gap) / n, ph = pw * 0.68;
        for (let pi = 0; pi < n; pi++) {
          try {
            const b64 = 'data:image/jpeg;base64,' + photos[pi].toString('base64');
            doc.addImage(b64, 'JPEG', M + pi * (pw + gap), y2, pw, ph, undefined, 'FAST');
          } catch (e) {
            doc.setFillColor(237, 242, 247); doc.rect(M + pi * (pw + gap), y2, pw, ph, 'F');
          }
        }
        y2 += ph + 4;
      }

      // Table header
      const refW = 20;
      doc.setFillColor(45, 55, 72); doc.rect(M, y2, CW, 8, 'F');
      doc.setFillColor(197, 48, 48); doc.rect(M + refW, y2, 1.2, 8, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text('Ref', M + refW / 2, y2 + 5.5, { align: 'center' });
      doc.text('Detail / Drawing Reference', M + refW + 4, y2 + 5.5);
      y2 += 8;

      // Rows
      const elev = elevations.find(e => e.name === ELEV_NAMES[ei]);
      const rows = elev ? elev.rows.filter(r => r.ref || r.desc) : [];
      if (rows.length) {
        rows.forEach((row, ri) => {
          const rh = 9;
          if (ri % 2 === 0) { doc.setFillColor(237, 242, 247); doc.rect(M, y2, CW, rh, 'F'); }
          // Red ref cell
          doc.setFillColor(255, 245, 245); doc.rect(M, y2, refW, rh, 'F');
          doc.setFillColor(197, 48, 48); doc.rect(M + refW, y2, 1.2, rh, 'F');
          // Ref number - big bold red
          doc.setTextColor(197, 48, 48); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
          doc.text(String(row.ref || ''), M + refW / 2, y2 + 6.5, { align: 'center' });
          // Description
          doc.setTextColor(45, 55, 72); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
          doc.text(String(row.desc || ''), M + refW + 4, y2 + 6, { maxWidth: CW - refW - 6 });
          doc.setDrawColor(203, 213, 224); doc.setLineWidth(0.2);
          doc.line(M, y2 + rh, M + CW, y2 + rh);
          y2 += rh;
        });
      } else {
        doc.setFillColor(237, 242, 247); doc.rect(M, y2, CW, 9, 'F');
        doc.setTextColor(160, 174, 192); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.text('No considerations recorded for this elevation', M + 4, y2 + 6);
        y2 += 9;
      }

      y2 += 4;
      // Comments heading
      doc.setFillColor(74, 85, 104); doc.rect(M, y2, CW, 8, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text('General Considerations & Comments:', M + 3, y2 + 5.5);
      y2 += 8;
      // Comments box
      doc.setDrawColor(203, 213, 224); doc.setLineWidth(0.4);
      doc.rect(M, y2, CW, 28);
      y2 += 32;
    }

    const pdfOutput = doc.output('arraybuffer');
    const pdfBuffer = Buffer.from(pdfOutput);
    const fname = `EWI_${address.replace(/\s+/g, '_')}_${postcode}.pdf`;

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fname}"`
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true
    };

  } catch (e) {
    console.error('PDF error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

async function extractImages(xlsxB64) {
  const result = {};
  try {
    const raw = Buffer.from(xlsxB64.split(',').pop(), 'base64');
    const zip = await JSZip.loadAsync(raw);
    const sheetDraw = {};
    for (let i = 1; i <= 9; i++) {
      const rp = `xl/worksheets/_rels/sheet${i}.xml.rels`;
      if (!zip.files[rp]) continue;
      const xml = await zip.files[rp].async('string');
      const m = xml.match(/drawing(\d+)\.xml/);
      if (m) sheetDraw[i] = parseInt(m[1]);
    }
    for (const [sn, dn] of Object.entries(sheetDraw)) {
      const rp = `xl/drawings/_rels/drawing${dn}.xml.rels`;
      const dp = `xl/drawings/drawing${dn}.xml`;
      if (!zip.files[rp] || !zip.files[dp]) continue;
      const relXml = await zip.files[rp].async('string');
      const ridMap = {};
      const re = /<Relationship[^>]+Id="(rId\d+)"[^>]+Target="[^"]*\/([^"/]+\.(jpg|jpeg|png))"[^>]*>/gi;
      let m;
      while ((m = re.exec(relXml)) !== null) ridMap[m[1]] = m[2];
      const drawXml = await zip.files[dp].async('string');
      const anchors = [...drawXml.matchAll(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g)];
      const imgs = [];
      for (const a of anchors) {
        const colM = a[0].match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
        const embM = a[0].match(/r:embed="(rId\d+)"/);
        if (!colM || !embM) continue;
        const fname = ridMap[embM[1]];
        if (!fname) continue;
        const mp = `xl/media/${fname}`;
        if (!zip.files[mp]) continue;
        const buf = await zip.files[mp].async('nodebuffer');
        imgs.push({ col: parseInt(colM[1]), buf });
      }
      imgs.sort((a, b) => a.col - b.col);
      result[parseInt(sn) - 1] = imgs.map(i => i.buf);
    }
  } catch (e) { console.error('extractImages:', e.message); }
  return result;
}
