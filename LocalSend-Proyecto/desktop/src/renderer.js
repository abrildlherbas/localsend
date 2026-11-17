const $ = id => document.getElementById(id);
const requests = new Map();
function size(bytes) { if (!Number.isFinite(bytes)) return 'Tamaño desconocido'; const u=['B','KB','MB','GB']; let n=bytes,i=0; while(n>=1024&&i<u.length-1){n/=1024;i++} return `${n.toFixed(i?1:0)} ${u[i]}`; }
function activity(message) { $('activity').textContent = `${new Date().toLocaleTimeString()} · ${message}`; }
window.localsend.info().then(info => { $('ip').textContent=info.ip; $('connection').textContent='Servicios activos'; activity(`Listo en ${info.ip} · UDP ${info.udpPort} · WS ${info.wsPort}`); });
window.localsend.on('status', msg => activity(msg));
window.localsend.on('incoming', item => {
  requests.set(item.id,item); $('count').textContent=requests.size;
  const empty=$('requests').querySelector('.empty-icon'); if(empty) $('requests').innerHTML='';
  const el=document.createElement('div'); el.className='request'; el.id=`req-${item.id}`;
  const icon=document.createElement('div'); icon.className='file-icon'; icon.textContent='📄';
  const info=document.createElement('div'); info.className='file-info';
  const name=document.createElement('b'); name.textContent=item.name;
  const meta=document.createElement('small'); meta.textContent=`${item.from} · ${size(item.size)}`;
  info.append(name,meta);
  const actions=document.createElement('div'); actions.className='actions';
  const yes=document.createElement('button'); yes.className='button accept'; yes.textContent='Aceptar';
  const no=document.createElement('button'); no.className='button reject'; no.textContent='Rechazar';
  yes.onclick=()=>decide(item.id,true); no.onclick=()=>decide(item.id,false);
  actions.append(yes,no); el.append(icon,info,actions); $('requests').append(el); activity(`Solicitud recibida: ${item.name}`);
});
async function decide(id, accepted) {
  const result=await window.localsend.decide(id,accepted);
  if(!result.ok){activity(result.error);return}
  document.getElementById(`req-${id}`)?.remove(); requests.delete(id); $('count').textContent=requests.size;
  if(!requests.size) $('requests').innerHTML='<div class="empty"><div class="empty-icon">⇩</div><b>Esperando dispositivos…</b><span>Cuando un teléfono te encuentre, aparecerá su solicitud.</span></div>';
  activity(accepted?'Transferencia aceptada.':'Transferencia rechazada.');
}
window.localsend.on('progress', p => {
  const el=document.getElementById(`req-${p.id}`);
  if(el){let bar=el.querySelector('.progress');if(!bar){bar=document.createElement('div');bar.className='progress';bar.innerHTML='<span></span>';el.append(bar)}bar.firstElementChild.style.width=`${Math.min(100,p.received/Math.max(1,p.size)*100)}%`;}
  activity(`Recibiendo ${p.name}: ${Math.round(p.received/Math.max(1,p.size)*100)}%`);
});
window.localsend.on('complete', item => activity(`Archivo recibido: ${item.name} (${size(item.size)})`));
