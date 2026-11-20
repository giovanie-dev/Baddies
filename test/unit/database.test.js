const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pool, connectDB } = require('../../config/db')

test('connectDB : libère la connexion après vérification', async t => {
  const release = t.mock.fn()
  t.mock.method(pool, 'connect', async () => ({ release }))
  t.mock.method(console, 'log', () => {})
  await connectDB()
  assert.equal(release.mock.callCount(), 1)
})

test('connectDB : signale une panne sans rejeter sa promesse', async t => {
  t.mock.method(pool, 'connect', async () => { throw new Error('connexion indisponible') })
  const log = t.mock.method(console, 'error', () => {})
  await assert.doesNotReject(connectDB())
  assert.equal(log.mock.callCount(), 1)
})
