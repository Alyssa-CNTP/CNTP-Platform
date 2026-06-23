import shutil

src = "C:/Users/Alyssa/Downloads/cntp-ops/app/(app)/users/page.tsx"
dst = "/home/cntpdev/apps/staging/app/cntp-ops/app/(app)/users/page.tsx"

content = open(src, encoding='utf-8').read()
with open(dst, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'OK — wrote {len(content)} chars to {dst}')
