// Minimal stubs to satisfy lingering imports (safe to keep)
function shuffle(arr, seed){ const a=[...arr]; let s=seed??Math.floor(Math.random()*1e9);
  const rand=()=>{ s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/4294967296; };
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function toCSV(rows){ return rows.map(r=>r.map(c=>/[",\n]/.test(String(c))?'"'+String(c).replace(/"/g,'""')+'"':String(c)).join(",")).join("\n"); }
function download(filename,text){ const blob=new Blob([text],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}
function parseCSVStream(t){ const r=[],l=t.length; let i=0,row=[],cur="",q=false;
  while(i<l){ const ch=t[i];
    if(ch=='"'){ if(q&&i+1<l&&t[i+1]=='"'){ cur+='"'; i+=2; continue; } q=!q; i++; continue; }
    if(!q&&ch==','){ row.push(cur); cur=""; i++; continue; }
    if(!q&&(ch=='\n'||ch=='\r')){ row.push(cur); cur=""; if(row.some(c=>c!=="")) r.push(row); row=[];
      if(ch=='\r'&&i+1<l&&t[i+1]=='\n') i+=2; else i++; continue; }
    cur+=ch; i++;
  }
  if(cur.length>0||row.length>0){ row.push(cur); if(row.some(c=>c!=="")) r.push(row); }
  return r;
}
function parseCSV(text){ const table=parseCSVStream(text); if(!table.length) return [];
  const H=table[0].map(h=>h.trim().toLowerCase()); const ix=n=>H.indexOf(n);
  const qi=ix("id"),di=ix("domain"),qq=ix("question"),ai=ix("a"),bi=ix("b"),ci=ix("c"),dd=ix("d"),co=ix("correct"),ex=ix("explanation"),rf=ix("reference");
  const req=[di,qq,ai,bi,ci,dd,co]; if(req.some(i=>i<0)) return [];
  const allowed=new Set(["People","Process","Business","Agile"]);
  const toIdx=s=>{ const m={a:0,b:1,c:2,d:3}; const t=String(s).trim().toLowerCase(); if(t in m) return m[t]; if(/^[0-3]$/.test(t)) return Number(t); };
  return table.slice(1).reduce((out,row,r)=>{ if(!row||row.every(c=>!c||!String(c).trim())) return out;
    const ans=toIdx(row[co]||""); const dom=(row[di]||"").trim(); if(ans===undefined||!allowed.has(dom)) return out;
    out.push({ id:(qi>=0?(row[qi]||"").trim():"")||`U${r+1}`, domain:dom, question:(row[qq]||"").trim(),
      choices:[(row[ai]||"").trim(),(row[bi]||"").trim(),(row[ci]||"").trim(),(row[dd]||"").trim()],
      answerIndex:ans, explanation: ex>=0 ? (row[ex]||""):"", reference: rf>=0 ? (row[rf]||""):"" }); return out; }, []);
}
export { shuffle, toCSV, download, parseCSV, parseCSVStream };
