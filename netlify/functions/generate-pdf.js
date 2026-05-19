const PDFDocument = require('pdfkit');
const JSZip = require('jszip');

const W = 595.28, H = 841.89, MARGIN = 51;
const DARK_SLATE='#2D3748', SLATE='#4A5568', LIGHT_SLATE='#EDF2F7';
const MID_GREY='#CBD5E0', WARM_GREY='#718096', RED_REF='#C53030';
const LIGHT_RED='#FFF5F5', ACCENT='#A0AEC0';

function fillRect(doc,x,y,w,h,col){doc.save().rect(x,y,w,h).fill(col).restore();}

function drawCover(doc,companyName,companyFull){
  fillRect(doc,0,0,W,H,'#FFFFFF');
  fillRect(doc,0,0,14,H,SLATE);
  fillRect(doc,0,H-37,W,37,DARK_SLATE);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  doc.text(companyName,MARGIN,H-26,{lineBreak:false});
  doc.font('Helvetica').fontSize(7).fillColor(ACCENT);
  doc.text(companyFull,MARGIN,H-15,{lineBreak:false});
}

function drawInner(doc,companyName,companyFull,address,postcode,pageNum){
  fillRect(doc,0,0,W,37,DARK_SLATE);
  fillRect(doc,0,37,W,4,SLATE);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  doc.text('EWI Thermal Bridging Design Document',MARGIN,14,{lineBreak:false});
  doc.font('Helvetica').fontSize(8).fillColor(ACCENT);
  doc.text(`${address}  |  ${postcode}`,0,14,{align:'right',lineBreak:false,width:W-MARGIN});
  doc.save().moveTo(MARGIN,H-42).lineTo(W-MARGIN,H-42).lineWidth(0.5).stroke(MID_GREY).restore();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(WARM_GREY);
  doc.text(companyName,MARGIN,H-36,{lineBreak:false});
  doc.font('Helvetica').fontSize(6.5).fillColor(WARM_GREY);
  doc.text(companyFull,MARGIN,H-26,{lineBreak:false,width:W-2*MARGIN-60});
  doc.text(`Page ${pageNum}`,0,H-36,{align:'right',lineBreak:false,width:W-MARGIN});
}

function infoRow(doc,label,value,y,shade){
  const rh=22;
  if(shade)fillRect(doc,MARGIN,y,W-2*MARGIN,rh,LIGHT_SLATE);
  fillRect(doc,MARGIN+153,y,1.5,rh,SLATE);
  doc.save().moveTo(MARGIN,y+rh).lineTo(W-MARGIN,y+rh).lineWidth(0.3).stroke(MID_GREY).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK_SLATE);
  doc.text(label,MARGIN+7,y+7,{lineBreak:false,width:140});
  doc.font('Helvetica').fontSize(9).fillColor(WARM_GREY);
  doc.text(value||'—',MARGIN+163,y+7,{lineBreak:false,width:W-2*MARGIN-170});
  return rh;
}

async function extractImages(xlsxB64){
  const result={};
  try{
    const raw=Buffer.from(xlsxB64.split(',').pop(),'base64');
    const zip=await JSZip.loadAsync(raw);
    const sheetDraw={};
    for(let i=1;i<=9;i++){
      const rp=`xl/worksheets/_rels/sheet${i}.xml.rels`;
      if(!zip.files[rp])continue;
      const xml=await zip.files[rp].async('string');
      const m=xml.match(/drawing(\d+)\.xml/);
      if(m)sheetDraw[i]=parseInt(m[1]);
    }
    for(const[sn,dn]of Object.entries(sheetDraw)){
      const rp=`xl/drawings/_rels/drawing${dn}.xml.rels`;
      const dp=`xl/drawings/drawing${dn}.xml`;
      if(!zip.files[rp]||!zip.files[dp])continue;
      const relXml=await zip.files[rp].async('string');
      const ridMap={};
      const re=/<Relationship[^>]+Id="(rId\d+)"[^>]+Target="[^"]*\/([^"/]+\.(jpg|jpeg|png))"[^>]*>/gi;
      let m;
      while((m=re.exec(relXml))!==null)ridMap[m[1]]=m[2];
      const drawXml=await zip.files[dp].async('string');
      const anchors=[...drawXml.matchAll(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g)];
      const imgs=[];
      for(const a of anchors){
        const colM=a[0].match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
        const embM=a[0].match(/r:embed="(rId\d+)"/);
        if(!colM||!embM)continue;
        const fname=ridMap[embM[1]];
        if(!fname)continue;
        const mp=`xl/media/${fname}`;
        if(!zip.files[mp])continue;
        const buf=await zip.files[mp].async('nodebuffer');
        imgs.push({col:parseInt(colM[1]),buf});
      }
      imgs.sort((a,b)=>a.col-b.col);
      result[parseInt(sn)-1]=imgs.map(i=>i.buf);
    }
  }catch(e){console.error('extractImages:',e.message);}
  return result;
}

function drawElevation(doc,label,rows,photos,startY){
  const cw=W-2*MARGIN;
  let y=startY;

  fillRect(doc,MARGIN,y,cw,26,DARK_SLATE);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
  doc.text(label,MARGIN+8,y+7,{lineBreak:false});
  y+=26;
  fillRect(doc,MARGIN,y,cw,3,SLATE);
  y+=11;

  if(photos&&photos.length>0){
    const n=Math.min(photos.length,3),gap=6;
    const pw=(cw-(n-1)*gap)/n,ph=pw*0.68;
    for(let i=0;i<n;i++){
      try{doc.image(photos[i],MARGIN+i*(pw+gap),y,{width:pw,height:ph,cover:[pw,ph]});}
      catch(e){fillRect(doc,MARGIN+i*(pw+gap),y,pw,ph,LIGHT_SLATE);}
    }
    y+=ph+10;
  }

  const rw=56;
  fillRect(doc,MARGIN,y,cw,22,DARK_SLATE);
  fillRect(doc,MARGIN+rw,y,3,22,RED_REF);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  doc.text('Ref',MARGIN+4,y+7,{lineBreak:false,width:rw-8,align:'center'});
  doc.text('Detail / Drawing Reference',MARGIN+rw+10,y+7,{lineBreak:false});
  y+=22;

  if(rows&&rows.length){
    rows.forEach((row,i)=>{
      const rh=26,bg=i%2===0?LIGHT_SLATE:'#FFFFFF';
      fillRect(doc,MARGIN,y,cw,rh,bg);
      fillRect(doc,MARGIN,y,rw,rh,LIGHT_RED);
      fillRect(doc,MARGIN+rw,y,3,rh,RED_REF);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(RED_REF);
      doc.text(String(row.ref||''),MARGIN,y+4,{width:rw,align:'center',lineBreak:false});
      doc.font('Helvetica').fontSize(9).fillColor(DARK_SLATE);
      doc.text(String(row.desc||''),MARGIN+rw+10,y+8,{width:cw-rw-16,lineBreak:false});
      doc.save().moveTo(MARGIN,y+rh).lineTo(W-MARGIN,y+rh).lineWidth(0.3).stroke(MID_GREY).restore();
      y+=rh;
    });
  }else{
    fillRect(doc,MARGIN,y,cw,26,LIGHT_SLATE);
    doc.font('Helvetica').fontSize(9).fillColor(WARM_GREY);
    doc.text('No considerations recorded',MARGIN+10,y+8,{lineBreak:false});
    y+=26;
  }

  y+=10;
  fillRect(doc,MARGIN,y,cw,22,SLATE);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
  doc.text('General Considerations & Comments:',MARGIN+8,y+7,{lineBreak:false});
  y+=22;
  doc.save().rect(MARGIN,y,cw,70).lineWidth(0.5).stroke(MID_GREY).restore();
  y+=78;
  return y;
}

exports.handler=async(event)=>{
  const headers={
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST,OPTIONS'
  };
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers,body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,headers,body:'Method not allowed'};

  try{
    const body=event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body;
    const data=JSON.parse(body);
    const{company,address,postcode,elevations=[]}=data;
    const designer=data.designer||'—';
    const jobRef=data.job_ref||'—';
    const photoB64=data.photo||null;
    const xlsxB64=data.xlsx||null;

    const companyName=company.name;
    const parts=[company.addr1];
    if(company.addr2)parts.push(company.addr2);
    parts.push(`${company.city}  ${company.postcode}`);
    if(company.phone)parts.push(company.phone);
    const companyFull=parts.join(', ');

    let sheetImages={};
    if(xlsxB64){
      try{sheetImages=await extractImages(xlsxB64);}
      catch(e){console.error('xlsx:',e.message);}
    }

    const chunks=[];
    const doc=new PDFDocument({size:'A4',margin:0,autoFirstPage:false});
    doc.on('data',c=>chunks.push(c));

    const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
    const cw=W-2*MARGIN;

    // COVER
    doc.addPage();
    drawCover(doc,companyName,companyFull);
    let y=MARGIN;

    doc.font('Helvetica-Bold').fontSize(20).fillColor(DARK_SLATE);
    doc.text(companyName,MARGIN,y,{width:cw});
    y=doc.y+4;
    doc.font('Helvetica').fontSize(10).fillColor(WARM_GREY);
    doc.text(companyFull,MARGIN,y,{width:cw});
    y=doc.y+12;

    doc.save().moveTo(MARGIN,y).lineTo(W-MARGIN,y).lineWidth(1.5).stroke(SLATE).restore();
    y+=14;

    if(photoB64){
      try{
        const buf=Buffer.from(photoB64.split(',').pop(),'base64');
        const heroH=cw*0.48;
        doc.image(buf,MARGIN,y,{width:cw,height:heroH,cover:[cw,heroH]});
        y+=heroH;
      }catch(e){
        fillRect(doc,MARGIN,y,cw,140,LIGHT_SLATE);
        y+=140;
      }
    }else{
      fillRect(doc,MARGIN,y,cw,140,LIGHT_SLATE);
      doc.font('Helvetica').fontSize(11).fillColor(MID_GREY);
      doc.text('Property photo not provided',MARGIN,y+60,{align:'center',width:cw});
      y+=140;
    }

    fillRect(doc,MARGIN,y,cw,56,DARK_SLATE);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF');
    doc.text('EWI Thermal Bridging Design Document',MARGIN+10,y+16,{width:cw-20,lineBreak:false});
    y+=66;

    const infoRows=[
      ['Property Address:',`${address}, ${postcode}`],
      ['System Designer:',designer],
      ['Job Reference:',jobRef],
      ['Prepared by:',companyName],
      ['Date:',today],
    ];
    infoRows.forEach(([l,v],i)=>{infoRow(doc,l,v,y,i%2===0);y+=22;});

    // ELEVATIONS
    const ELEV_NAMES=['Front Elevation','Back Elevation','Side Elevation 1','Side Elevation 2'];
    const ELEV_SHEETS=[0,1,null,null];
    let pageNum=1;

    for(let i=0;i<ELEV_NAMES.length;i++){
      doc.addPage();
      pageNum++;
      drawInner(doc,companyName,companyFull,address,postcode,pageNum-1);
      const elev=elevations.find(e=>e.name===ELEV_NAMES[i]);
      const rows=elev?elev.rows.filter(r=>r.ref||r.desc):[];
      const photos=ELEV_SHEETS[i]!==null?(sheetImages[ELEV_SHEETS[i]]||[]):[];
      drawElevation(doc,ELEV_NAMES[i],rows,photos,52);
    }

    doc.end();
    await new Promise(r=>doc.on('end',r));
    const pdf=Buffer.concat(chunks);
    const fname=`EWI_${address.replace(/\s+/g,'_')}_${postcode}.pdf`;

    return{
      statusCode:200,
      headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${fname}"`},
      body:pdf.toString('base64'),
      isBase64Encoded:true
    };
  }catch(e){
    console.error('PDF error:',e);
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
