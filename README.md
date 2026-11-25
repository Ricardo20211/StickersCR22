# botstickers con sonido

Bot de WhatsApp para hacer stickers. Funciona en Termux y en Windows.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `#s` | Convierte una foto o video en sticker |
| `#s "hola"` | Sticker con el texto "hola" abajo |
| `#s+a` | Sticker de video con sonido |
| `#toimg` | Sticker a imagen |
| `#tomp4` | Sticker animado a video |
| `#s-name "paquete" "autor"` | Cambia el nombre y el autor de un sticker |

Manda el comando junto con la foto o el video, o respondiendo a un mensaje.

## Instalar en Termux

Instala Termux desde [F-Droid](https://f-droid.org/packages/com.termux/),
[GitHub](https://github.com/termux/termux-app/releases) o la
[Play Store](https://play.google.com/store/apps/details?id=com.termux)
y escribe:

```bash
pkg update -y && pkg install -y git && git clone https://github.com/opgbl/botstickers ~/botstickers && cd ~/botstickers && bash start.sh
```

La primera vez instala todo lo necesario y te pregunta cómo vincular el
bot: `1` con código o `2` con QR.

Para volver a iniciarlo:

```bash
cd ~/botstickers && bash start.sh
```

## Instalar en Windows

1. Instala [Node.js](https://nodejs.org) (versión 20 o más nueva).
2. Instala ffmpeg. En PowerShell o CMD:

   ```
   winget install Gyan.FFmpeg
   ```

3. Descarga el bot en Code > Download ZIP y descomprímelo.
4. Abre `iniciar.bat`. La primera vez instala las dependencias y te
   pregunta cómo vincular el bot, igual que en Termux.

Para volver a iniciarlo, abre `iniciar.bat` otra vez.

## Problemas de conexión

Si el bot no conecta o se desconecta todo el tiempo, borra la sesión y
vuelve a vincularlo.

En Termux:

```bash
rm -rf ~/botstickers/baileys_auth_info && cd ~/botstickers && bash start.sh
```

En Windows, cierra el bot, borra la carpeta `baileys_auth_info` y abre
`iniciar.bat` otra vez.

También quita el dispositivo viejo en WhatsApp, en Dispositivos vinculados.

## Seguridad

Lee [SEGURIDAD.txt](SEGURIDAD.txt). No compartas la carpeta
`baileys_auth_info`, ahí está tu sesión de WhatsApp.
