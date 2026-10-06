# ☀️🌙 Claroscuro

Crea un fondo de pantalla para **macOS** que cambia solo entre **modo claro** y **modo oscuro**, igual que los fondos de Apple (por ejemplo, *Sonoma*).

No necesita apps de terceros ni procesos en segundo plano: genera un archivo `.heic` con dos imágenes y la etiqueta que macOS usa para alternarlas. Lo eliges como fondo y el sistema hace el resto.

**👉 Úsalo en línea: https://arrrnold.github.io/claroscuro/**

## Opción 1 — Página web (la más fácil)

1. Abre la página en **Safari** o **Chrome** en tu Mac.
2. Elige la imagen para el **modo claro** y la del **modo oscuro**.
3. Pulsa **Crear fondo** y descarga `claroscuro.heic`.

Todo se procesa **en tu navegador**: tus imágenes no se suben a ningún servidor.

## Opción 2 — Terminal (solo herramientas de Apple)

Necesitas Swift, que viene con las *Command Line Tools* de Xcode. Si no las tienes:

```bash
xcode-select --install
```

Descarga el script y ejecútalo:

```bash
curl -O https://raw.githubusercontent.com/arrrnold/claroscuro/main/cli/claroscuro.swift
```

```bash
swift claroscuro.swift claro.jpg oscuro.jpg MiFondo.heic
```

Para revisar si un `.heic` es un fondo dinámico:

```bash
swift claroscuro.swift --info MiFondo.heic
```

## Poner el fondo

1. Guarda el `.heic` en una carpeta fija (por ejemplo, `~/Pictures`). Si lo borras o lo mueves, macOS pierde el fondo.
2. **Ajustes del Sistema → Fondo de pantalla → Añadir foto…** y elige el archivo.
   También puedes hacer clic derecho en Finder → **Definir imagen de escritorio**.
3. Asegúrate de que esté en **Automático** (no en *Claro* ni *Oscuro* fijo).

Listo: cambia el modo en **Ajustes del Sistema → Apariencia** y el fondo cambiará con él.

## ¿Cómo funciona?

Un fondo dinámico de macOS es un archivo HEIF (`.heic`) con varias imágenes y un metadato XMP:

```xml
<apple_desktop:apr>  <!-- namespace http://ns.apple.com/namespace/1.0/ -->
  base64( plist binario { "l": 0, "d": 1 } )
</apple_desktop:apr>
```

`l` es el índice de la imagen para modo claro y `d` el de la imagen para modo oscuro.

- **El script** usa `ImageIO` de Apple para escribir el HEIC y el metadato.
- **La web** codifica las imágenes en HEVC con [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) y arma el contenedor HEIF a mano en JavaScript (`docs/heif.js`), sin dependencias. Divide cada imagen en mosaicos de 512×512 (una *grid*), igual que hace Apple, así que funciona con imágenes de 6K o más.

## Estructura

```
cli/claroscuro.swift   Script para la terminal
docs/                  Página web (GitHub Pages)
  index.html
  app.js               Interfaz
  heif.js              Codificación HEVC + contenedor HEIF
  style.css
```

## Publicar tu propia copia en GitHub Pages

En tu repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**, rama `main`, carpeta `/docs`.

## Compatibilidad

- macOS 10.14 Mojave o posterior (los fondos claro/oscuro llegaron con el modo oscuro).
- Web: Safari o Chrome recientes en Mac (deben poder codificar HEVC). Firefox todavía no puede; en ese caso usa el script.

## Licencia

[MIT](LICENSE) — úsalo, cámbialo y compártelo libremente.
