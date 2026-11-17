# Mobile – notas técnicas

La detección utiliza `react-native-udp`; por eso requiere `expo prebuild` y un development build nativo, no Expo Go. Los bloques se leen desde el archivo en base64 y se envían como mensajes binarios WebSocket de 64 KiB.

En Android moderno, el selector de documentos del sistema evita pedir acceso amplio al almacenamiento para los documentos elegidos por el usuario.

La transferencia de esta versión debe mantenerse con la app en primer plano. Para transferencias en segundo plano se debe agregar un Foreground Service Android y gestionar la notificación persistente.
