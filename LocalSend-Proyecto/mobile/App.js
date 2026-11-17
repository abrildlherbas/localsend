
import React, { useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator
} from 'react-native';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

const CHUNK = 64 * 1024;

export default function App() {
  const [ip, setIp] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ingresá la IP de tu computadora');

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false
    });

    if (!result.canceled) {
      setFile(result.assets[0]);
      setStatus('Archivo seleccionado');
    }
  }

  function waitMessage(ws) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Tiempo de espera agotado'));
      }, 30000);

      const handler = event => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (['ACCEPT', 'REJECT', 'DONE', 'ERROR'].includes(msg.type)) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);

          if (msg.type === 'ERROR') reject(new Error(msg.message));
          else resolve(msg);
        }
      };

      ws.addEventListener('message', handler);
    });
  }

  async function sendFile() {
    if (!ip.trim() || !file || busy) {
      Alert.alert('Atención', 'Ingresá la IP y seleccioná un archivo.');
      return;
    }

    setBusy(true);
    setProgress(0);

    let ws;

    try {
      setStatus('Conectando con la computadora...');

      ws = new WebSocket(`ws://${ip.trim()}:8080`);

      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('No se pudo conectar con la PC')),
          10000
        );

        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Error de conexión. Revisá la IP y el firewall.'));
        };
      });

      ws.send(JSON.stringify({
        type: 'FILE_OFFER',
        name: file.name,
        size: file.size || 0,
        mimeType: file.mimeType || 'application/octet-stream',
        from: 'Android'
      }));

      setStatus('Esperando confirmación en la PC...');

      const response = await waitMessage(ws);

      if (response.type !== 'ACCEPT') {
        throw new Error('La computadora rechazó el archivo.');
      }

      const info = await FileSystem.getInfoAsync(file.uri);
      const total = info.size || file.size || 0;

      if (!total) throw new Error('No se pudo determinar el tamaño del archivo.');

      let offset = 0;

      while (offset < total) {
        const length = Math.min(CHUNK, total - offset);

        const base64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: 'base64',
          position: offset,
          length
        });

        const binary = globalThis.atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        await new Promise((resolve, reject) => {
          if (ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Se perdió la conexión.'));
            return;
          }

          ws.send(bytes.buffer);
          setTimeout(resolve, 10);
        });

        offset += length;
        setProgress(Math.round(offset / total * 100));
      }

      ws.send(JSON.stringify({ type: 'FILE_END' }));

      const finished = await waitMessage(ws);

      if (finished.type === 'DONE') {
        setProgress(100);
        setStatus('¡Transferencia completada!');
        Alert.alert('¡Listo!', 'El archivo llegó correctamente a la PC.');
      }

    } catch (error) {
      setStatus(error.message);
      Alert.alert('Error', error.message);
    } finally {
      ws?.close();
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.title}>⇄ LocalSend</Text>
        <Text style={s.subtitle}>Compartí archivos por Wi-Fi</Text>

        <View style={s.card}>
          <Text style={s.heading}>Computadora de destino</Text>

          <TextInput
            style={s.input}
            placeholder="Ejemplo: 192.168.1.15"
            placeholderTextColor="#8491aa"
            value={ip}
            onChangeText={setIp}
            keyboardType="decimal-pad"
            editable={!busy}
          />

          <Text style={s.hint}>
            Encontrá la IP en la ventana de LocalSend Desktop.
          </Text>
        </View>

        <TouchableOpacity
          style={s.pick}
          onPress={chooseFile}
          disabled={busy}
        >
          <Text style={s.pickTitle}>＋ Seleccionar archivo</Text>
          <Text style={s.hint}>
            {file ? file.name : 'Fotos, videos y documentos'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.send, (!file || !ip.trim() || busy) && s.disabled]}
          onPress={sendFile}
          disabled={!file || !ip.trim() || busy}
        >
          <Text style={s.sendText}>
            {busy ? 'Enviando...' : 'Enviar archivo'}
          </Text>
        </TouchableOpacity>

        {busy && (
          <View style={s.progressTrack}>
            <View style={[s.progressBar, { width: `${progress}%` }]} />
          </View>
        )}

        {busy && <Text style={s.hint}>{progress}%</Text>}

        <Text style={s.status}>{status}</Text>
        <Text style={s.footer}>
          Ambos dispositivos deben estar conectados a la misma Wi-Fi.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b1020' },
  container: { flex: 1, padding: 25, justifyContent: 'center' },
  title: { color: 'white', fontSize: 32, fontWeight: '900' },
  subtitle: { color: '#91a0bd', marginBottom: 35 },
  card: {
    backgroundColor: '#172441', padding: 20,
    borderRadius: 17, marginBottom: 15
  },
  heading: { color: 'white', fontWeight: 'bold', marginBottom: 12 },
  input: {
    backgroundColor: '#0b1020', color: 'white',
    padding: 14, borderRadius: 10
  },
  hint: { color: '#91a0bd', fontSize: 12, marginTop: 9 },
  pick: {
    backgroundColor: '#172441', padding: 20,
    borderRadius: 15, marginBottom: 15
  },
  pickTitle: { color: '#69d9c1', fontWeight: 'bold', fontSize: 16 },
  send: {
    backgroundColor: '#69d9c1', padding: 17,
    borderRadius: 13, alignItems: 'center'
  },
  disabled: { opacity: 0.4 },
  sendText: { color: '#09221e', fontWeight: '900' },
  progressTrack: {
    height: 8, backgroundColor: '#293753',
    borderRadius: 8, marginTop: 20, overflow: 'hidden'
  },
  progressBar: { height: 8, backgroundColor: '#69d9c1' },
  status: { color: 'white', textAlign: 'center', marginTop: 20 },
  footer: {
    color: '#71809e', fontSize: 11,
    textAlign: 'center', marginTop: 35
  }
});
