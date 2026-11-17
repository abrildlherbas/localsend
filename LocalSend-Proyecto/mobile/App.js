import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import dgram from 'react-native-udp';

const UDP_PORT = 53317;
const CHUNK = 64 * 1024;

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('Buscando computadoras en tu Wi‑Fi…');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const socket = useRef(null);
  const ws = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    try {
      socket.current = dgram.createSocket('udp4');
      socket.current.bind(0);
      socket.current.on('message', msg => {
        try {
          const item = JSON.parse(msg.toString());
          if (item.type === 'DISCOVER' && item.host && item.port) {
            setDevices(old => old.some(x => x.host === item.host) ? old : [...old, item]);
          }
        } catch {}
      });
      const broadcast = () => {
        if (!socket.current) return;
        const payload = Buffer.from(JSON.stringify({ type: 'MOBILE_SEARCH' }));
        socket.current.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255', err => {
          if (err) setStatus(`No se pudo buscar: ${err.message}`);
        });
      };
      broadcast();
      const interval = setInterval(broadcast, 2000);
      return () => {
        alive.current = false;
        clearInterval(interval);
        try { socket.current?.close(); } catch {}
        try { ws.current?.close(); } catch {}
      };
    } catch (e) {
      setStatus(`Error de red: ${e.message}. Revisá los permisos y el build nativo.`);
    }
  }, []);

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (!result.canceled && result.assets?.[0]) setFile(result.assets[0]);
  }

  function waitMessage(websocket) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado')), 30000);
      const handler = event => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (['ACCEPT','REJECT','DONE','ERROR'].includes(data.type)) {
          clearTimeout(timer); websocket.removeEventListener('message', handler);
          data.type === 'ERROR' ? reject(new Error(data.message)) : resolve(data);
        }
      };
      websocket.addEventListener('message', handler);
    });
  }

  async function sendFile() {
    if (!selected || !file || busy) return;
    setBusy(true); setProgress(0); setStatus('Conectando con la computadora…');
    try {
      const connection = new WebSocket(`ws://${selected.host}:${selected.port}`);
      ws.current = connection;
      await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(new Error('No se pudo conectar a la PC')),10000);
        connection.onopen=()=>{clearTimeout(timer);resolve()};
        connection.onerror=()=>{clearTimeout(timer);reject(new Error('Error de conexión. Revisá el firewall de la PC.'))};
      });
      connection.send(JSON.stringify({ type:'FILE_OFFER', name:file.name, size:file.size || 0, mimeType:file.mimeType || 'application/octet-stream', from:'Android' }));
      setStatus('Esperando que acepten el archivo…');
      const decision = await waitMessage(connection);
      if (decision.type !== 'ACCEPT') throw new Error('La computadora rechazó el archivo.');
      setStatus('Enviando archivo…');
      const info = await FileSystem.getInfoAsync(file.uri, { size: true });
      const total = info.size || file.size || 0;
      let offset = 0;
      while (offset < total) {
        const length = Math.min(CHUNK, total - offset);
        const base64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64', position: offset, length
        });
        const binary = globalThis.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
        await new Promise((resolve,reject) => {
          if (connection.readyState !== WebSocket.OPEN) return reject(new Error('Se perdió la conexión.'));
          connection.send(bytes.buffer);
          // WebSocket conserva el orden de los mensajes; pequeña pausa para no saturar memoria.
          setTimeout(resolve, 8);
        });
        offset += length;
        setProgress(Math.min(100, Math.round(offset / Math.max(1,total) * 100)));
      }
      connection.send(JSON.stringify({ type:'FILE_END' }));
      const done = await waitMessage(connection);
      if (done.type === 'DONE') {
        setProgress(100); setStatus('¡Archivo enviado correctamente!');
        Alert.alert('Transferencia completada', `${file.name} se envió a ${selected.name}.`);
      }
      connection.close();
    } catch (e) {
      setStatus(e.message);
      Alert.alert('No se pudo enviar', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.header}><View style={s.logo}><Text style={s.logoText}>⇄</Text></View><View><Text style={s.title}>LocalSend</Text><Text style={s.subtitle}>Compartí sin cables</Text></View></View>
        <View style={s.hero}><Text style={s.kicker}>TU RED LOCAL</Text><Text style={s.heroTitle}>Enviar archivos</Text><Text style={s.description}>Elegí un archivo y seleccioná la computadora que lo va a recibir.</Text></View>
        <TouchableOpacity style={s.pick} onPress={chooseFile} disabled={busy}><Text style={s.pickIcon}>＋</Text><View style={{flex:1}}><Text style={s.pickTitle}>{file ? file.name : 'Seleccionar un archivo'}</Text><Text style={s.pickSub}>{file ? `${Math.round((file.size||0)/1024)} KB · Listo para enviar` : 'Fotos, videos y documentos'}</Text></View><Text style={s.chevron}>›</Text></TouchableOpacity>
        <View style={s.sectionHead}><Text style={s.sectionTitle}>Computadoras disponibles</Text><TouchableOpacity onPress={()=>{setDevices([]);setStatus('Buscando computadoras…')}}><Text style={s.refresh}>Actualizar</Text></TouchableOpacity></View>
        {devices.length===0 ? <View style={s.empty}><ActivityIndicator color="#69d9c1"/><Text style={s.emptyText}>{status}</Text><Text style={s.hint}>Asegurate de que la PC esté abierta y en la misma Wi‑Fi.</Text></View> :
          <FlatList data={devices} keyExtractor={item=>item.host} renderItem={({item})=><TouchableOpacity style={[s.device,selected?.host===item.host&&s.deviceSelected]} onPress={()=>setSelected(item)}><Text style={s.computer}>▣</Text><View style={{flex:1}}><Text style={s.deviceName}>{item.name}</Text><Text style={s.deviceIp}>{item.host}</Text></View><Text style={s.radio}>{selected?.host===item.host?'●':'○'}</Text></TouchableOpacity>} />}
        {selected && <TouchableOpacity disabled={!file||busy} style={[s.send,(!file||busy)&&s.disabled]} onPress={sendFile}><Text style={s.sendText}>{busy?'Enviando…':'Enviar archivo'}</Text></TouchableOpacity>}
        {busy && <View style={s.progressWrap}><View style={s.progressTrack}><View style={[s.progressBar,{width:`${progress}%`}]} /></View><Text style={s.progressText}>{progress}% · {status}</Text></View>}
        {!busy && <Text style={s.status}>{status}</Text>}
        <Text style={s.footer}>Los dispositivos deben estar conectados a la misma red Wi‑Fi.</Text>
      </View>
    </SafeAreaView>
  );
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:'#0b1020'},container:{flex:1,padding:22,paddingTop:30},
 header:{flexDirection:'row',alignItems:'center',gap:13,marginBottom:28},logo:{width:48,height:48,borderRadius:15,backgroundColor:'#596fff',alignItems:'center',justifyContent:'center'},logoText:{fontSize:30,color:'white',fontWeight:'800'},title:{fontSize:21,fontWeight:'800',color:'#f2f5ff'},subtitle:{color:'#91a0bd',fontSize:12,marginTop:2},
 hero:{backgroundColor:'#172441',borderWidth:1,borderColor:'#293a60',borderRadius:22,padding:22,marginBottom:18},kicker:{color:'#67d9c1',fontSize:10,fontWeight:'800',letterSpacing:2},heroTitle:{color:'white',fontSize:27,fontWeight:'800',marginTop:10},description:{color:'#a7b5d0',fontSize:13,lineHeight:20,marginTop:7},
 pick:{backgroundColor:'#151f35',borderWidth:1,borderColor:'#2b3a59',borderRadius:16,padding:16,flexDirection:'row',alignItems:'center',gap:13},pickIcon:{fontSize:28,color:'#68d9c1'},pickTitle:{color:'#edf2ff',fontWeight:'700',fontSize:14},pickSub:{color:'#8e9db9',fontSize:11,marginTop:4},chevron:{fontSize:25,color:'#8493b3'},
 sectionHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:28,marginBottom:12},sectionTitle:{color:'#edf2ff',fontSize:16,fontWeight:'800'},refresh:{color:'#6ddbc4',fontSize:12,fontWeight:'700'},
 empty:{alignItems:'center',justifyContent:'center',padding:25,backgroundColor:'#121b2e',borderRadius:16,gap:10},emptyText:{color:'#dce5fa',fontSize:13,textAlign:'center'},hint:{color:'#8796b2',fontSize:11,textAlign:'center'},
 device:{flexDirection:'row',alignItems:'center',gap:13,padding:15,backgroundColor:'#151f35',borderRadius:15,borderWidth:1,borderColor:'#283753',marginBottom:9},deviceSelected:{borderColor:'#65d8c1',backgroundColor:'#172c37'},computer:{fontSize:25,color:'#72d9c4'},deviceName:{color:'#edf2ff',fontWeight:'700'},deviceIp:{color:'#91a0bd',fontSize:11,marginTop:3},radio:{color:'#67d9c1',fontSize:20},
 send:{backgroundColor:'#64d9c0',padding:16,borderRadius:14,alignItems:'center',marginTop:16},disabled:{opacity:.4},sendText:{color:'#09221e',fontWeight:'900',fontSize:15},
 progressWrap:{marginTop:16},progressTrack:{height:7,backgroundColor:'#273550',borderRadius:8,overflow:'hidden'},progressBar:{height:7,backgroundColor:'#64d9c0'},progressText:{color:'#a9b7d2',fontSize:11,marginTop:8},status:{color:'#a9b7d2',fontSize:11,marginTop:14,textAlign:'center'},footer:{color:'#65738f',fontSize:10,textAlign:'center',marginTop:'auto',paddingTop:18}
});
