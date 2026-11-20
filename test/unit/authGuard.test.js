const { test } = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
process.env.JWT_SECRET = 'secret-reserve-aux-tests'
const { pool } = require('../../config/db')
const authMiddleware = require('../../middlewares/authMiddleware')

async function check(t, authorization, rows = [], error) {
  const query = t.mock.method(pool, 'query', async () => {
    if (error) throw error
    return { rows }
  })
  t.mock.method(console, 'error', () => {})
  const req = { headers: { authorization } }
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
  const next = t.mock.fn()
  await authMiddleware(req, res, next)
  return { req, res, query, next }
}
const sign = (id, options = {}) => jwt.sign({ id }, process.env.JWT_SECRET, options)

for (const value of [undefined, '', 'Basic abc', 'Bearer ']) test(`Authentification : refuse l’absence de Bearer (${value})`, async t => {
  const { res, query, next } = await check(t, value)
  assert.equal(res.statusCode, 401)
  assert.equal(query.mock.callCount(), 0)
  assert.equal(next.mock.callCount(), 0)
})

for (const id of [undefined, null, 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, {}, '0', '-1', '01', 'abc', '9223372036854775808']) {
  test(`Authentification : refuse un identifiant invalide (${JSON.stringify(id)})`, async t => {
    const { res, query, next } = await check(t, `Bearer ${sign(id)}`)
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.title, 'Token invalide')
    assert.equal(query.mock.callCount(), 0)
    assert.equal(next.mock.callCount(), 0)
  })
}

for (const id of [7, '7', '9223372036854775807']) test(`Authentification : accepte un identifiant valide (${typeof id} ${id})`, async t => {
  const user = { id, email: 'alice@example.com', pseudo: 'Alice', avatar_url: null }
  const { req, res, query, next } = await check(t, `Bearer ${sign(id)}`, [user])
  assert.equal(res.statusCode, 200)
  assert.deepEqual(req.user, user)
  assert.equal(req.user.password, undefined)
  assert.deepEqual(query.mock.calls[0].arguments[1], [id])
  assert.equal(next.mock.callCount(), 1)
})

for (const [label, token, title] of [
  ['mal formé', 'incorrect', 'Token invalide'],
  ['expiré', sign(7, { expiresIn: -1 }), 'Token expiré'],
  ['pas encore actif', sign(7, { notBefore: '1h' }), 'Token invalide'],
  ['mauvaise signature', jwt.sign({ id: 7 }, 'autre-secret'), 'Token invalide']
]) test(`Authentification : refuse le JWT ${label}`, async t => {
  const { res, query, next } = await check(t, `Bearer ${token}`)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.title, title)
  assert.equal(query.mock.callCount(), 0)
  assert.equal(next.mock.callCount(), 0)
})

test('Authentification : refuse un compte supprimé', async t => {
  const { res, next } = await check(t, `Bearer ${sign(7)}`)
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.title, 'Utilisateur introuvable')
  assert.equal(next.mock.callCount(), 0)
})

test('Authentification : une panne SQL ne donne aucun accès', async t => {
  const { req, res, next } = await check(t, `Bearer ${sign(7)}`, [], new Error('détail SQL privé'))
  assert.equal(res.statusCode, 500)
  assert.equal(req.user, undefined)
  assert.equal(next.mock.callCount(), 0)
  assert.doesNotMatch(JSON.stringify(res.body), /SQL privé/)
})
