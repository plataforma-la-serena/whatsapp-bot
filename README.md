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

Para probar sin enviar mensajes reales, usar `WHATSAPP_ALERT_DRY_RUN=true`.

## Audios

Las notas de voz se descargan de WhatsApp, se convierten con `ffmpeg` y se
transcriben con `whisper.cpp`. La transcripción se guarda como mensaje del
cliente (con el prefijo 🎤) y se procesa como si hubiera escrito ese texto.

Instalación:

```bash
bash scripts/setup-whisper.sh
```

Por defecto usa `~/.local/share/whisper.cpp` con el modelo `base`
(multilingüe, ~142 MB). Se puede cambiar con `WHISPER_BIN`, `WHISPER_MODEL`,
`WHISPER_LANGUAGE` y `WHISPER_THREADS`. Para mejor precisión en español se
puede descargar `small` (`bash models/download-ggml-model.sh small` en el
directorio de whisper.cpp) y apuntar `WHISPER_MODEL` a ese archivo.

Si la transcripción falla, el bot responde "No pude escuchar el audio. ¿Me lo
podés escribir?" y deja el intento registrado en el panel.
