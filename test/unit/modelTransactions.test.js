const { test } = require('node:test')
const assert = require('node:assert/strict')
const { pool } = require('../../config/db')
const model = require('../../models/userModel')
const expiry = new Date('2030-01-01T00:00:00Z')

// Les requêtes sont interceptées : aucune donnée n'est lue ou écrite en PostgreSQL.
for (const [name, args, queryPattern] of [
  ['findByEmailOrPseudo', ['alice@example.com', "Alice' OR 1=1 --"], /email = \$1 OR pseudo = \$2/],
  ['findByEmailExcludingId', ['alice@example.com', 7], /id <> \$2/],
  ['findById', [7], /WHERE id = \$1/],
  ['findProfileConflict', [7, 'alice@example.com', 'Alice'], /id <> \$1/],
  ['findAccountForDeletion', [7], /SELECT id, password/],
  ['changeUser', ['Alice', 'alice@example.com', 'hash', '/avatar.png', 7], /WHERE id = \$5/]
]) for (const found of [true, false]) {
  test(`${name} : ${found ? 'renvoie le résultat avec des paramètres séparés' : 'renvoie null en l’absence de résultat'}`, async t => {
    const row = { id: 7 }
    t.mock.method(pool, 'query', async (sql, params) => {
      assert.match(sql, queryPattern)
      assert.deepEqual(params, args)
      assert.ok(!sql.includes('alice@example.com'))
      assert.ok(!sql.includes('OR 1=1'))
      return { rows: found ? [row] : [] }
    })
    assert.deepEqual(await model[name](...args), found ? row : null)
  })
}

for (const [name, args, table] of [
  ['createUser', ['alice@example.com', 'hash', 'Alice', null], 'Users'],
  ['createToken', [7, 'hash', expiry], 'Password_reset_tokens'],
  ['createRefreshToken', [7, 'hash', expiry], 'Refresh_tokens']
]) test(`${name} : transmet les valeurs séparément de l’insertion SQL`, async t => {
  const row = { id: 11 }
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, new RegExp(`INSERT INTO "${table}"`))
    assert.match(sql, /RETURNING/)
    assert.deepEqual(params, args)
    return { rows: [row] }
  })
  assert.deepEqual(await model[name](...args), row)
})

for (const name of ['findValidResetTokens', 'findValidRefreshTokens']) test(`${name} : filtre les jetons périmés et révoqués/consommés`, async t => {
  const rows = [{ id: 11, token_hash: 'hash' }]
  t.mock.method(pool, 'query', async sql => {
    assert.match(sql, /expires_at > NOW\(\)/)
    assert.match(sql, name === 'findValidResetTokens' ? /used_at IS NULL/ : /revoked_at IS NULL/)
    return { rows }
  })
  assert.deepEqual(await model[name](), rows)
})

for (const count of [0, 1]) {
  for (const [name, args, expected] of [
    ['revokeUserRefreshTokens', [7], count],
    ['revokeRefreshTokenById', [11], count === 1],
    ['deleteAccount', [7, 'hash-observe'], count === 1]
  ]) test(`${name} : respecte le nombre de lignes modifiées (${count})`, async t => {
    t.mock.method(pool, 'query', async (sql, params) => {
      assert.deepEqual(params, args)
      if (name === 'deleteAccount') assert.match(sql, /WHERE id = \$1 AND password = \$2/)
      else assert.match(sql, /revoked_at IS NULL/)
      return { rowCount: count }
    })
    assert.equal(await model[name](...args), expected)
  })
}

test('Les erreurs des requêtes simples sont propagées', async t => {
  const error = new Error('PostgreSQL indisponible')
  t.mock.method(pool, 'query', async () => { throw error })
  await assert.rejects(model.findById(7), error)
})

// Un faux client permet de contrôler les courses et les rollbacks, sans vraie transaction.
function transaction(t, handler) {
  const calls = []
  let released = 0
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      return handler(sql, params)
    },
    release() { released++ }
  }
  t.mock.method(pool, 'connect', async () => client)
  return { calls, released: () => released }
}

for (const name of ['changePasswordAndClearToken', 'rotateRefreshToken']) {
  const invoke = () => name === 'changePasswordAndClearToken'
    ? model[name]('hash-neuf', 7, 11) : model[name](11, 7, 'hash-neuf', expiry)
  const consumePattern = name === 'changePasswordAndClearToken' ? /DELETE FROM "Password_reset_tokens"/ : /UPDATE "Refresh_tokens"/

  for (const failure of ['compte absent', 'jeton déjà consommé', 'panne après consommation', 'succès']) {
    test(`${name} : ${failure}`, async t => {
      const tx = transaction(t, (sql, params) => {
        if (sql.includes('SELECT')) {
          assert.deepEqual(params, [7])
          assert.match(sql, /FOR UPDATE/)
          return { rowCount: failure === 'compte absent' ? 0 : 1, rows: [{ id: 7 }] }
        }
        if (consumePattern.test(sql) && sql.includes('RETURNING')) {
          assert.deepEqual(params, [11, 7])
          assert.match(sql, /expires_at > NOW\(\)/)
          return { rowCount: failure === 'jeton déjà consommé' ? 0 : 1 }
        }
        if (sql.includes('INSERT INTO') || sql.includes('SET password')) {
          if (failure === 'panne après consommation') throw new Error('écriture impossible')
          assert.deepEqual(params, name === 'changePasswordAndClearToken' ? ['hash-neuf', 7] : [7, 'hash-neuf', expiry])
        }
        return { rowCount: 1, rows: [] }
      })
      if (failure === 'panne après consommation') await assert.rejects(invoke, /écriture impossible/)
      else assert.equal(await invoke(), failure === 'succès')
      assert.equal(tx.calls[0].sql, 'BEGIN')
      assert.equal(tx.calls.at(-1).sql, failure === 'succès' ? 'COMMIT' : 'ROLLBACK')
      assert.equal(tx.released(), 1)
      if (failure !== 'succès') assert.ok(!tx.calls.some(c => c.sql === 'COMMIT'))
      if (failure === 'compte absent') assert.equal(tx.calls.length, 3)
      if (failure === 'jeton déjà consommé') assert.equal(tx.calls.length, 4)
      if (failure === 'succès' && name === 'changePasswordAndClearToken') {
        assert.ok(tx.calls.some(c => /UPDATE "Refresh_tokens"/.test(c.sql) && c.params[0] === 7))
        assert.ok(tx.calls.some(c => /DELETE FROM "Password_reset_tokens"/.test(c.sql) && !c.sql.includes('RETURNING') && c.params[0] === 7))
      }
    })
  }
}

for (const hashedPassword of [null, undefined, 'hash-neuf']) test(`updateUser : ${hashedPassword ? 'révoque les sessions si le mot de passe change' : 'conserve les sessions sans changement de mot de passe (' + hashedPassword + ')'}`, async t => {
  const row = { id: 7, pseudo: 'Alice' }
  const tx = transaction(t, (sql, params) => {
    if (sql.includes('SELECT')) return { rowCount: 1 }
    if (sql.includes('UPDATE "Users"')) {
      assert.match(sql, /COALESCE\(\$1, email\)/)
      assert.deepEqual(params, [null, hashedPassword, 'Alice', null, 7])
      return { rows: [row] }
    }
    return { rowCount: 1 }
  })
  assert.deepEqual(await model.updateUser(7, { email: null, hashedPassword, pseudo: 'Alice', avatarUrl: null }), row)
  assert.equal(tx.calls.filter(c => c.sql.includes('UPDATE "Refresh_tokens"')).length, hashedPassword ? 1 : 0)
  assert.equal(tx.calls.at(-1).sql, 'COMMIT')
  assert.equal(tx.released(), 1)
})

for (const scenario of ['compte absent', 'aucun résultat', 'panne']) test(`updateUser : ${scenario}`, async t => {
  const tx = transaction(t, sql => {
    if (sql.includes('SELECT')) return { rowCount: scenario === 'compte absent' ? 0 : 1 }
    if (sql.includes('UPDATE "Users"')) {
      if (scenario === 'panne') throw new Error('écriture impossible')
      return { rows: [] }
    }
    return { rowCount: 1 }
  })
  const invoke = () => model.updateUser(7, { email: null, hashedPassword: null, pseudo: 'Alice', avatarUrl: null })
  if (scenario === 'panne') await assert.rejects(invoke, /écriture impossible/)
  else assert.equal(await invoke(), null)
  assert.equal(tx.calls.at(-1).sql, scenario === 'aucun résultat' ? 'COMMIT' : 'ROLLBACK')
  assert.equal(tx.released(), 1)
})
