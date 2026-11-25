# whatsapp-bot
## Avisos al equipo

Cuando un cliente pide hablar con una persona, o cuando muestra interés en
reservar, el bot avisa al número configurado en `WHATSAPP_ALERT_PHONE`
(por defecto `5492613368554`).

- Si la ventana de 24 horas con ese número está abierta, se envía un texto
  directo.
- Si está cerrada, se usa la plantilla aprobada indicada en
  `WHATSAPP_ALERT_TEMPLATE`. Sin plantilla configurada, el aviso no se envía y
  queda un error en el log.

Variables:

```env
WHATSAPP_ALERT_PHONE=5492613368554
WHATSAPP_ALERT_TEMPLATE=aviso_equipo_5
WHATSAPP_ALERT_TEMPLATE_LANG=es
WHATSAPP_ALERT_DRY_RUN=false
```

Plantilla creada en Meta (categoría Utility, idioma español, pendiente de
aprobación), con dos variables separadas por texto y valores de ejemplo:

```text
Notificación de servicio: el número {{1}}, que {{2}}. Se requiere una respuesta del equipo.
```

Ejemplo: `5491111111111` / `quiere hablar con una persona real`.

El bot envía `{{1}}` = teléfono del cliente y `{{2}}` = motivo
(`quiere hablar con una persona real` o `está interesado en reservar`).

Para abrir la ventana de 24 h sin depender de una plantilla, el número de avisos
puede enviar al bot:

```text
abrir avisos
```

El bot responde confirmando el canal y, desde ese mensaje, los avisos llegan como
texto libre durante 24 horas.

Para probar sin enviar mensajes reales, usar `WHATSAPP_ALERT_DRY_RUN=true`.

## Audios

Las notas de voz se descargan de WhatsApp y se transcriben con una API externa
compatible con OpenAI (`/audio/transcriptions`). La transcripción se guarda como
mensaje del cliente (con el prefijo 🎤) y se procesa como si hubiera escrito ese
texto.

Proveedor recomendado: **Groq** con `whisper-large-v3-turbo` (rápido, económico y
con buen español). También funciona con OpenAI (`whisper-1` o
`gpt-4o-mini-transcribe`) o cualquier API compatible.

```env
TRANSCRIPTION_MODE=external
TRANSCRIPTION_API_URL=https://api.groq.com/openai/v1/audio/transcriptions
TRANSCRIPTION_API_KEY=tu-api-key
TRANSCRIPTION_MODEL=whisper-large-v3-turbo
TRANSCRIPTION_LANGUAGE=es
```

Si `TRANSCRIPTION_API_KEY` está vacía o la API falla, se usa `whisper.cpp`
local como respaldo (ver `scripts/setup-whisper.sh`). Para forzar solo el modo
local: `TRANSCRIPTION_MODE=local`.

Si la transcripción falla por completo, el bot responde "No pude escuchar el
audio. ¿Me lo podés escribir?" y deja el intento registrado en el panel.

## Calidad

```bash
npm run typecheck  # tipos
npm test           # pruebas (Vitest)
npm run coverage   # pruebas + coverage/coverage-summary.json
npm run build      # compila a dist/
npm audit --omit=dev
```

CI en `.github/workflows/ci.yml`: install → typecheck → test + coverage → build
→ auditoría de dependencias.
