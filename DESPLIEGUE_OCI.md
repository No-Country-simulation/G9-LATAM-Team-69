# Despliegue en OCI

Cómo está desplegado el sistema y cómo mantenerlo.

## Arquitectura de despliegue

```
Navegador ──HTTPS──> Caddy (VM OCI Compute, puertos 80/443)
                       ├─ sirve el frontend estático (/var/www/energia)
                       └─ /api/*  ──> API Spring Boot (localhost:8080, systemd)
                                          └─ carga model.onnx desde OCI Object Storage
```

- **URL de producción:** `https://129.151.116.82.nip.io/`
- **IP pública reservada:** `129.151.116.82` (fija, no cambia al reiniciar la VM)

## Componentes

### 1. OCI Object Storage — el modelo

- Bucket: `Nova-enegia`, objeto `Nova-onnxmodel.onnx`.
- Acceso mediante **Pre-Authenticated Request (PAR)** de solo lectura.
- La API lo consume por su URL, configurada en `application.yaml`:
  ```yaml
  onnx:
    model:
      path: https://objectstorage.sa-santiago-1.oraclecloud.com/p/.../o/Nova-onnxmodel.onnx
  ```
  Spring resuelve esa URL como recurso remoto (`UrlResource`) y descarga el modelo al arrancar.

> Si el PAR expira, crear uno nuevo en el bucket y actualizar `application.yaml`.

### 2. OCI Compute — la API

- VM Ubuntu con Java 21 (JDK).
- La API corre como servicio **systemd** (`energia-api.service`), de modo que arranca sola y
  sobrevive a reinicios de la VM.

Comandos útiles (dentro de la VM):
```bash
sudo systemctl status energia-api     # ver estado
sudo systemctl restart energia-api    # reiniciar
sudo journalctl -u energia-api -f     # ver logs en vivo
```

### 3. Caddy — HTTPS y proxy

- Sirve el frontend estático y hace de proxy inverso a la API.
- Obtiene el certificado HTTPS automáticamente de Let's Encrypt, usando el dominio
  `129.151.116.82.nip.io` (nip.io convierte la IP en un dominio válido).
- Configuración (`/etc/caddy/Caddyfile`):
  ```
  129.151.116.82.nip.io {
      handle /api/* {
          reverse_proxy localhost:8080 {
              header_up -Origin
          }
      }
      handle {
          root * /var/www/energia
          file_server
      }
  }
  ```
- `header_up -Origin` elimina la cabecera `Origin` en las llamadas a la API (frontend y API son
  mismo dominio, así se evita el rechazo de CORS de Spring sin recompilar).

Comandos útiles:
```bash
sudo systemctl restart caddy
sudo journalctl -u caddy -f
```

## Red (OCI Networking)

- VCN con **Internet Gateway** y una **subred pública**.
- **Route Table** de la subred con ruta `0.0.0.0/0 → Internet Gateway`.
- **Security List** con reglas de ingreso (Source `0.0.0.0/0`, TCP) para los puertos **22** (SSH),
  **80** y **443** (HTTP/HTTPS).
- Firewall del sistema operativo (iptables) también con 22, 80 y 443 abiertos y persistidos.

## Cómo redesplegar la API (tras cambios de código)

```bash
# En la VM, dentro del proyecto clonado:
git pull                              # traer la última versión de la branch
mvn clean package -DskipTests         # recompilar
cp target/*-SNAPSHOT.jar ~/api-energy-model-test.jar
sudo systemctl restart energia-api    # reiniciar el servicio
```

## Cómo actualizar el frontend

```bash
# copiar los archivos actualizados a /var/www/energia y dar permisos de lectura
sudo cp -r <frontend>/* /var/www/energia/
sudo chmod -R a+rX /var/www/energia
# no requiere reiniciar Caddy
```

## ⚠️ Notas de mantenimiento

- **No reiniciar la VM sin necesidad.** Aunque la IP es reservada (fija), mantener la VM encendida
  durante el evento evita cualquier interrupción.
- Si en algún momento **cambia la IP pública**, hay que actualizar el dominio en el `Caddyfile`
  (las dos apariciones) y reiniciar Caddy; Caddy sacará un certificado nuevo automáticamente.
- El certificado de Let's Encrypt se renueva solo mientras el puerto 80 siga abierto.
