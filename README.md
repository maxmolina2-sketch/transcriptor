# Transcriptor

Aplicación web para transcribir audio a texto **gratis y de forma privada**.
La transcripción se ejecuta con el modelo Whisper **dentro del navegador** de cada persona:
el audio nunca se sube a ningún servidor.

- Archivos de audio y video (MP3, WAV, M4A, OGG, WEBM, MP4, FLAC) o grabación con micrófono
- Español por defecto; detección automática y otros idiomas
- Marcas de tiempo, texto editable y reproducción sincronizada
- Exporta a `.txt`, `.txt` con tiempos, `.srt`, `.vtt` y `.json`
- Sin servidor, sin claves de API, sin costo

---

## Estructura

```
transcriptor/
├── index.html        Interfaz
├── css/styles.css    Estilos (modo claro y oscuro)
├── js/app.js         Lógica de interfaz, carga de audio, grabación
├── js/worker.js      Motor Whisper (Transformers.js) en un Web Worker
├── js/export.js      Formatos de exportación
├── netlify.toml      Configuración de Netlify
└── README.md
```

No hay paso de compilación: son archivos estáticos.

---

## Despliegue (GitHub → Netlify)

### 1. Subir a GitHub
1. Crea un repositorio nuevo en <https://github.com/new> (por ejemplo `transcriptor`). Puede ser privado.
2. Sube los archivos de esta carpeta:
   - **Sin terminal:** en el repositorio vacío, usa *uploading an existing file* y arrastra todo el contenido de la carpeta (incluidas `css/` y `js/`).
   - **Con terminal:**
     ```bash
     cd transcriptor
     git init
     git add .
     git commit -m "Primera versión del transcriptor"
     git branch -M main
     git remote add origin https://github.com/TU_USUARIO/transcriptor.git
     git push -u origin main
     ```

### 2. Conectar con Netlify
1. Entra a <https://app.netlify.com> e inicia sesión con tu cuenta de GitHub.
2. **Add new site → Import an existing project → GitHub** y elige el repositorio.
3. Deja los campos así (el `netlify.toml` ya los define):
   - Build command: *(vacío)*
   - Publish directory: `.`
4. **Deploy**. En menos de un minuto tendrás una URL tipo `https://nombre-aleatorio.netlify.app`.
5. Opcional: *Site configuration → Change site name* para algo como `transcriptor-equipo.netlify.app`.

Desde ahí, cada cambio que subas a GitHub se publica automáticamente.

### 3. Compartir con el equipo
Comparte la URL. Cada persona transcribe en su propio equipo, por lo que no hay
límites de uso compartidos ni costos que crezcan con el número de usuarios.

> **Sobre restringir el acceso:** la protección con contraseña de Netlify es una función de
> planes de pago. En el plan gratuito, la opción práctica es no difundir la URL públicamente.
> Como la app no almacena audios ni textos en ningún servidor, una URL abierta no expone
> información del equipo: solo la herramienta.

---

## Uso

1. Carga un archivo o graba con el micrófono.
2. Elige el modelo:

   | Modelo | Descarga aprox. | Uso recomendado |
   |---|---|---|
   | tiny | ~40 MB | Pruebas rápidas, celulares |
   | base | ~80 MB | Uso general en CPU |
   | small | ~250 MB | Buena precisión en español (recomendado con GPU) |
   | large-v3-turbo | ~600 MB | Máxima precisión; solo con WebGPU |

3. Presiona **Transcribir**. La primera vez se descarga el modelo; después queda en caché.
4. Revisa y corrige el texto (es editable), luego copia o descarga.

### Rendimiento esperado
- **Con WebGPU** (Chrome/Edge recientes en computador): varias veces más rápido que el tiempo real con `small`.
- **Solo CPU**: con `base`, un audio de 30 minutos puede tardar entre 10 y 30 minutos según el equipo.
- El audio se procesa en bloques de ~5 minutos, cortados en silencios, y el texto aparece a medida que avanza.

### Recomendaciones
- Mantén la pestaña abierta y en primer plano durante transcripciones largas.
- Audio limpio (un micrófono cerca, poco ruido) mejora mucho el resultado.
- Para entrevistas largas en equipos lentos, usa `base` y revisa después.

---

## Privacidad
- El audio se decodifica y transcribe localmente (Web Worker + WebAssembly/WebGPU).
- Lo único que se descarga de internet es la librería (jsDelivr) y el modelo (Hugging Face).
- No hay analítica, cookies ni almacenamiento del contenido.

Esto la hace adecuada para entrevistas de investigación con datos sensibles,
siempre sujeto a los protocolos éticos de cada proyecto.

---

## Personalización rápida
- **Idioma por defecto:** en `index.html`, cambia el `selected` del `<select id="language">`.
- **Modelo por defecto:** en `js/app.js`, función `renderModelOptions()`.
- **Colores:** variables al inicio de `css/styles.css`.
- **Tamaño de bloque:** `SEGMENT_S` en `js/worker.js`.

## Créditos
- [Whisper](https://github.com/openai/whisper) (OpenAI, licencia MIT)
- [Transformers.js](https://github.com/huggingface/transformers.js) (Hugging Face, Apache 2.0)
- Modelos ONNX de [onnx-community](https://huggingface.co/onnx-community)
