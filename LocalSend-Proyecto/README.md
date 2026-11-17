# LocalSend – Proyecto Desktop + Mobile

Proyecto académico para transferir archivos entre una PC y un Android dentro de la misma red Wi‑Fi.

## Contenido
- `desktop/`: aplicación Electron. Publica beacons UDP en el puerto 53317 y recibe transferencias por WebSocket en el puerto 8080.
- `mobile/`: aplicación Expo/React Native. Descubre PCs por UDP, permite elegir un archivo y lo envía por WebSocket en bloques de 64 KB.

## Requisitos
- Node.js 20 o superior.
- Android Studio + Android SDK para compilar/ejecutar Android.
- PC y Android conectados a la misma Wi‑Fi.
- Permitir UDP 53317 y TCP 8080 en el firewall de la PC.

> Este ZIP contiene el código fuente. No incluye APK ni instalador compilados: esos binarios deben generarse en el sistema destino siguiendo los pasos de abajo.

## Ejecutar Desktop
```bash
cd desktop
npm install
npm start
```
La ventana muestra la IP local y espera conexiones. Los archivos recibidos se guardan en `Descargas/LocalSend`.

## Ejecutar Mobile
La app usa `react-native-udp`, que requiere código nativo y no funciona en Expo Go estándar. Se debe generar un development build:

```bash
cd mobile
npm install
npx expo prebuild
npx expo run:android
```

Si se usa un emulador Android, la PC puede no ser detectable por broadcast según la configuración de red. Para la prueba real, usar un teléfono conectado a la misma Wi‑Fi.

## Compilar APK
Desde `mobile/`, con Android SDK configurado:
```bash
cd android
./gradlew assembleRelease
```
El APK queda en `android/app/build/outputs/apk/release/`.

## Compilar Desktop
Desde `desktop/`:
```bash
npm install
npm run make
```
Se genera el paquete correspondiente a la plataforma actual en `out/`.

## Protocolo
1. Desktop emite un JSON UDP `{type:"DISCOVER", ...}` periódicamente por broadcast.
2. Mobile escucha UDP 53317 y muestra las PCs detectadas.
3. Mobile abre WebSocket `ws://IP_PC:8080`.
4. Mobile envía JSON `FILE_OFFER` con nombre, tamaño y MIME.
5. Desktop responde `ACCEPT` o `REJECT` desde la interfaz.
6. Mobile envía el archivo en mensajes binarios de hasta 64 KiB.
7. Mobile envía `FILE_END`; Desktop cierra el archivo y confirma `DONE`.

## Seguridad y límites de esta versión
- Diseñado para una LAN de confianza; no cifra el tráfico ni autentica dispositivos.
- Aceptar archivos antes de guardarlos, y no abrir automáticamente los archivos recibidos.
- La primera versión envía desde Mobile hacia Desktop (el flujo principal de la consigna).
- La detección depende de que el router permita broadcast y de las reglas del firewall.
