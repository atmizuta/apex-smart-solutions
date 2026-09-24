import paramiko
import hashlib
import posixpath
from datetime import datetime

HOST = "45.152.46.187"
PORT = 65002
USER = "u160600135"
PASS = "Apex308@!"

REMOTE_DIR = "domains/apexsmart.com.br/public_html"
REMOTE_PAINEL = posixpath.join(REMOTE_DIR, "painel_clientes_apex.html")
REMOTE_IMG = posixpath.join(REMOTE_DIR, "biometria_preview.png")
BACKUP_DIR = "backups_painel_clientes_apex"

LOCAL_PAINEL = "/sessions/affectionate-eloquent-bohr/mnt/outputs/painel_clientes_apex.html"
LOCAL_IMG = "/sessions/affectionate-eloquent-bohr/mnt/outputs/biometria_preview.png"

def md5_local(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def md5_remote(sftp, path):
    h = hashlib.md5()
    with sftp.open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

transport = paramiko.Transport((HOST, PORT))
transport.connect(username=USER, password=PASS)
sftp = paramiko.SFTPClient.from_transport(transport)

try:
    sftp.stat(BACKUP_DIR)
except FileNotFoundError:
    sftp.mkdir(BACKUP_DIR)

# --- backup do painel atual ---
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_path = posixpath.join(BACKUP_DIR, f"painel_clientes_apex_{timestamp}.html")
sftp.get(REMOTE_PAINEL, f"/tmp/_backup_painel_{timestamp}.html")
sftp.put(f"/tmp/_backup_painel_{timestamp}.html", backup_path)
print("Backup do painel salvo em:", backup_path)

# --- upload da imagem V2 (sobrescreve V1) ---
sftp.put(LOCAL_IMG, REMOTE_IMG)
md5_l_img = md5_local(LOCAL_IMG)
md5_r_img = md5_remote(sftp, REMOTE_IMG)
print("MD5 local  (imagem):", md5_l_img)
print("MD5 remoto (imagem):", md5_r_img)
assert md5_l_img == md5_r_img, "MD5 da imagem não bate!"
print("Imagem OK.")

# --- upload do painel atualizado ---
sftp.put(LOCAL_PAINEL, REMOTE_PAINEL)
md5_l_painel = md5_local(LOCAL_PAINEL)
md5_r_painel = md5_remote(sftp, REMOTE_PAINEL)
print("MD5 local  (painel):", md5_l_painel)
print("MD5 remoto (painel):", md5_r_painel)
assert md5_l_painel == md5_r_painel, "MD5 do painel não bate!"
print("Painel OK.")

sftp.close()
transport.close()
print("--- DEPLOY CONCLUÍDO ---")
