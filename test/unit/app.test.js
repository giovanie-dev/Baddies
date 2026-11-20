const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const app = require('../../app')

test('Les routes publiques répondent correctement', async () => {
  // Le port 0 laisse le système choisir un port disponible.
  const server = app.listen(0, '127.0.0.1')

  try {
    await once(server, 'listening')

    const port = server.address().port
    const url = `http://127.0.0.1:${port}`

    // L’ancienne API ne doit ni lire ni accepter un historique, même sans jeton.
    for (const [method, path] of [
      ['GET', '/api/v1/history'], ['POST', '/api/v1/history'],
      ['POST', '/api/v1/history/import'], ['GET', '/api/v1/history/episode-test'],
      ['DELETE', '/api/v1/history/episode-test']
    ]) {
      const response = await fetch(`${url}${path}`, { method })
      assert.equal(response.status, 404, `${method} ${path}`)
    }
    // La route du profil existe toujours et reste protégée.
    const profile = await fetch(`${url}/api/v1/user/profile`, { method: 'PATCH' })
    assert.equal(profile.status, 401)

    // Vérifier la route de santé.
    const health = await fetch(`${url}/health`)

    assert.equal(health.status, 200)
    assert.equal(await health.text(), 'OK')

    // Vérifier la route d’accueil.
    const accueil = await fetch(url)

    assert.equal(accueil.status, 200)
    assert.equal(
      await accueil.text(),
      'Bienvenue sur mon API RESTful !'
    )
  } finally {
    // Fermer le serveur même si une vérification échoue.
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })

      server.closeAllConnections()
    })
  }
})



