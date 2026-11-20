const { test } = require('node:test')
const assert = require('node:assert/strict')

const { pool } = require('../../config/db')
const userModel = require('../../models/userModel')

test('findByEmail : renvoie le compte trouvé', async t => {
  const compte = {
    id: 7,
    email: 'jojo@example.com'
  }

  t.mock.method(pool, 'query', async (sql, params) => {
    // Vérifier la valeur transmise séparément au SQL.
    assert.deepEqual(params, ['jojo@example.com'])

    return { rows: [compte] }
  })

  const resultat = await userModel.findByEmail('jojo@example.com')

  assert.deepEqual(resultat, compte)
})

test('findByEmail : renvoie null si aucun compte ne correspond', async t => {
  t.mock.method(pool, 'query', async () => {
    return { rows: [] }
  })

  const resultat = await userModel.findByEmail('inconnu@example.com')

  assert.equal(resultat, null)
})

test('rotateRefreshToken : valide la transaction et libère la connexion', async t => {
  const requetes = []
  let connexionLiberee = false

  const client = {
    async query(sql) {
      requetes.push(sql)

      // Simuler un compte trouvé et un ancien token actif.
      return { rowCount: 1, rows: [{ id: 7 }] }
    },

    release() {
      connexionLiberee = true
    }
  }

  t.mock.method(pool, 'connect', async () => {
    return client
  })

  const expiration = new Date(Date.now() + 60 * 60 * 1000)

  const resultat = await userModel.rotateRefreshToken(
    8,
    7,
    'nouvelle-empreinte',
    expiration
  )

  assert.equal(resultat, true)
  assert.equal(requetes[0], 'BEGIN')
  assert.equal(requetes[requetes.length - 1], 'COMMIT')
  assert.equal(connexionLiberee, true)
})

test('rotateRefreshToken : annule la transaction en cas d’erreur', async t => {
  const requetes = []
  let connexionLiberee = false

  const client = {
    async query(sql) {
      requetes.push(sql)

      // Simuler une panne pendant la recherche du compte.
      if (sql.includes('SELECT')) {
        throw new Error('Base indisponible')
      }

      return { rowCount: 1, rows: [] }
    },

    release() {
      connexionLiberee = true
    }
  }

  t.mock.method(pool, 'connect', async () => {
    return client
  })

  const expiration = new Date(Date.now() + 60 * 60 * 1000)

  await assert.rejects(
    () => userModel.rotateRefreshToken(
      8,
      7,
      'nouvelle-empreinte',
      expiration
    ),
    /Base indisponible/
  )

  assert.equal(requetes[requetes.length - 1], 'ROLLBACK')
  assert.equal(connexionLiberee, true)
})