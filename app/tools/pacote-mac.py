"""Monta o pacote "instalar com banco" do Mac (zip) a partir dos .dmg e da pasta do banco.

Uso:
  python tools/pacote-mac.py <saida.zip> <pasta-banco> <dmg> [<dmg> ...]

<pasta-banco> tem avdp.db e fundos/ (a mesma pasta "banco" do pacote do Windows).
Os .dmg vêm do release (build do GitHub Actions). O zip guarda o instalar.command
com permissão de execução (zip feito no Windows perde o +x se não for assim).
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
MAC = os.path.join(HERE, '..', 'mac')


def add(z, src, arc, exe=False):
    info = zipfile.ZipInfo.from_file(src, arc)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = ((0o755 if exe else 0o644) | 0o100000) << 16
    with open(src, 'rb') as f, z.open(info, 'w', force_zip64=True) as out:
        while chunk := f.read(1 << 20):
            out.write(chunk)


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    out, banco, dmgs = sys.argv[1], sys.argv[2], sys.argv[3:]
    if not os.path.isfile(os.path.join(banco, 'avdp.db')):
        sys.exit(f'sem avdp.db em {banco}')
    root = os.path.splitext(os.path.basename(out))[0]
    with zipfile.ZipFile(out, 'w', allowZip64=True) as z:
        add(z, os.path.join(MAC, 'instalar.command'), f'{root}/instalar.command', exe=True)
        add(z, os.path.join(MAC, 'LEIA-ME.txt'), f'{root}/LEIA-ME.txt')
        for d in dmgs:
            add(z, d, f'{root}/{os.path.basename(d)}')
        for dirpath, _, files in os.walk(banco):
            for f in files:
                if f.endswith(('-wal', '-shm')):
                    continue
                p = os.path.join(dirpath, f)
                rel = os.path.relpath(p, banco).replace(os.sep, '/')
                add(z, p, f'{root}/banco/{rel}')
    print(out, os.path.getsize(out) // (1 << 20), 'MB')


if __name__ == '__main__':
    main()
