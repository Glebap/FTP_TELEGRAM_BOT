#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'

const env = { ...process.env }

const url = new URL(process.env.DATABASE_URL)
const target = url.protocol === 'file:' && url.pathname
const newDb = target && !fs.existsSync(target)
await exec('npx prisma migrate deploy')
if (newDb) await exec('tsx src/db/seed.ts')

// launch application
await exec(process.argv.slice(2).join(' '))

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
