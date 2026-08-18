#!/usr/bin/env node
// 版本号唯一入口：一条命令同步 package.json / tauri.conf.json / Cargo.toml / Cargo.lock 四处。
//
//   pnpm bump 0.4.2     指定版本
//   pnpm bump patch     0.4.1 -> 0.4.2
//   pnpm bump minor     0.4.1 -> 0.5.0
//   pnpm bump major     0.4.1 -> 1.0.0
//
// 改完 commit + push 到 main 即触发发版（见 .github/workflows/release.yml）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv[2]

if (!arg) {
  console.error('用法: pnpm bump <version|patch|minor|major>')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version

const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : increment(current, arg)

function increment(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  console.error(`无法识别的版本参数: ${kind}（可用 patch / minor / major 或形如 1.2.3 的版本号）`)
  process.exit(1)
}

if (next === current) {
  console.error(`版本号已经是 ${current}，无需修改`)
  process.exit(1)
}

// 四处替换都用「锚定到唯一上下文的正则 + 只替换第一处」，避免误伤依赖项的版本号
const edits = [
  {
    file: 'package.json',
    // 顶层 "version" 字段（依赖项写作 "react": "^19"，不含 version 键名，不会误匹配）
    find: /"version":\s*"[^"]+"/,
    to: `"version": "${next}"`,
  },
  {
    file: 'src-tauri/tauri.conf.json',
    find: /"version":\s*"[^"]+"/,
    to: `"version": "${next}"`,
  },
  {
    file: 'src-tauri/Cargo.toml',
    // [package] 段的 version，是文件里第一个行首 version =
    find: /^version = "[^"]+"/m,
    to: `version = "${next}"`,
  },
  {
    file: 'src-tauri/Cargo.lock',
    // 锁文件里同名包很多，必须靠 name = "photo-browser" 定位
    find: /(name = "photo-browser"\nversion = )"[^"]+"/,
    to: `$1"${next}"`,
  },
]

for (const { file, find, to } of edits) {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  if (!find.test(before)) {
    console.error(`✗ ${file}: 没找到版本号字段，请检查文件格式`)
    process.exit(1)
  }
  writeFileSync(path, before.replace(find, to))
  console.log(`✓ ${file}`)
}

console.log(`\n版本号 ${current} → ${next}`)
console.log(`\n下一步：\n  git commit -am "chore: bump ${next}"\n  git push\n\npush 到 main 后 CI 会自动打 tag v${next}、构建 dmg、发布 Release，构建成功后才更新官网。`)
