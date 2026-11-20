const { test } = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { BrevoClient } = require('@getbrevo/brevo')

process.env.JWT_SECRET = 'secret-reserve-aux-tests'
process.env.BREVO_API_KEY = 'cle-fictive-de-test'
process.env.BREVO_SENDER = 'baddies@example.com'

const model = require('../../models/userModel')
const auth = require('../../controllers/authController')
const emailMethods = Object.getPrototypeOf(new BrevoClient({ apiKey: 'test' }).transactionalEmails)
const token = 'a'.repeat(64)
const user = { id: 7, email: 'alice@example.com', pseudo: 'Alice', password: 'hash-secret', avatar_url: '/avatar.png' }
const response = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this },
  json(body) { this.body = body; return this },
  send() { return this }
})
const fail = async () => { throw new Error('panne simulée, détail privé') }

// Toute dépendance externe est remplacée avant l'appel du contrôleur.
function setup(t) {
  t.mock.method(console, 'error', () => {})
  t.mock.method(bcrypt, 'hash', async () => 'nouveau-hash')
  t.mock.method(bcrypt, 'compare', async () => true)
  t.mock.method(emailMethods, 'sendTransacEmail', async () => ({}))
  const defaults = {
    findByEmail: user, findByEmailOrPseudo: null, createUser: user,
    createToken: {}, createRefreshToken: {},
    findValidResetTokens: [{ id: 11, user_id: 7, token_hash: 'reset-hash' }],
    findValidRefreshTokens: [{ id: 12, user_id: 7, token_hash: 'refresh-hash' }],
    changePasswordAndClearToken: true, rotateRefreshToken: true,
    findProfileConflict: null, updateUser: user,
    revokeRefreshTokenById: true, findAccountForDeletion: user, deleteAccount: true
  }
  for (const [method, value] of Object.entries(defaults)) t.mock.method(model, method, async () => value)
}

for (const [method, dependency, body] of [
  ['register', 'createUser', { email: user.email, pseudo: user.pseudo, password: 'Fort123!' }],
  ['login', 'createRefreshToken', { email: user.email, password: 'Fort123!' }],
  ['forgotPassword', 'findByEmail', { email: user.email }],
  ['resetPassword', 'changePasswordAndClearToken', { token, newPassword: 'Fort123!' }],
  ['refreshTokens', 'rotateRefreshToken', { token }],
  ['logout', 'revokeRefreshTokenById', { token }],
  ['updateProfile', 'updateUser', { pseudo: 'Alice' }],
  ['deleteAccount', 'deleteAccount', { password: 'Fort123!', confirmation: 'SUPPRIMER' }]
]) {
  test(`${method} : une panne ne divulgue pas les détails internes`, async t => {
    setup(t)
    t.mock.method(model, dependency, fail)
    const res = response()
    await auth[method]({ body, user: { id: 7 } }, res)
    assert.equal(res.statusCode, 500)
    assert.doesNotMatch(JSON.stringify(res.body), /panne simulée|hash-secret|Fort123/)
  })
}

test('Mot de passe oublié : même réponse publique pour une adresse connue ou inconnue', async t => {
  setup(t)
  let message
  t.mock.method(emailMethods, 'sendTransacEmail', async value => { message = value })
  const save = t.mock.method(model, 'createToken', async (id, hash, expiry) => {
    assert.equal(id, 7)
    assert.equal(hash, 'nouveau-hash')
    assert.ok(Math.abs(expiry.getTime() - Date.now() - 3600000) < 2000)
  })
  const known = response()
  await auth.forgotPassword({ body: { email: user.email } }, known)
  assert.equal(known.statusCode, 200)
  assert.deepEqual(message.to, [{ email: user.email }])
  assert.match(message.textContent, /token=[a-f0-9]{64}/)
  assert.equal(save.mock.callCount(), 1)
  t.mock.method(model, 'findByEmail', async () => null)
  const unknown = response()
  await auth.forgotPassword({ body: { email: 'inconnue@example.com' } }, unknown)
  assert.deepEqual(unknown.body, known.body)
  assert.equal(save.mock.callCount(), 1)
})

test('Mot de passe oublié : un échec d’envoi est signalé', async t => {
  setup(t)
  t.mock.method(emailMethods, 'sendTransacEmail', fail)
  const res = response()
  await auth.forgotPassword({ body: { email: user.email } }, res)
  assert.equal(res.statusCode, 500)
})

for (const [label, body, status] of [
  ['corps absent', undefined, 400], ['token absent', { newPassword: 'Fort123!' }, 400],
  ['mot de passe absent', { token }, 400], ['format du token', { token: 'incorrect', newPassword: 'Fort123!' }, 401],
  ['token non textuel', { token: 123, newPassword: 'Fort123!' }, 401],
  ['mot de passe faible', { token, newPassword: 'faible' }, 400],
  ['mot de passe non textuel', { token, newPassword: 123 }, 400]
]) test(`Réinitialisation : refuse ${label} sans modifier la base`, async t => {
  setup(t)
  const save = model.changePasswordAndClearToken
  const res = response()
  await auth.resetPassword({ body }, res)
  assert.equal(res.statusCode, status)
  assert.equal(save.mock.callCount(), 0)
})

for (const matches of [[], [{ id: 11, user_id: 7, token_hash: 'inconnu' }]]) {
  test(`Réinitialisation : refuse ${matches.length ? 'un token non reconnu' : 'un token expiré ou absent'}`, async t => {
    setup(t)
    t.mock.method(model, 'findValidResetTokens', async () => matches)
    t.mock.method(bcrypt, 'compare', async () => false)
    const res = response()
    await auth.resetPassword({ body: { token, newPassword: 'Fort123!' } }, res)
    assert.equal(res.statusCode, 401)
    assert.equal(model.changePasswordAndClearToken.mock.callCount(), 0)
  })
}

for (const changed of [true, false]) test(`Réinitialisation : ${changed ? 'remplace le mot de passe' : 'refuse un lien consommé entre-temps'}`, async t => {
  setup(t)
  t.mock.method(model, 'findValidResetTokens', async () => [
    { id: 10, user_id: 8, token_hash: 'autre' }, { id: 11, user_id: 7, token_hash: 'correspond' }
  ])
  t.mock.method(bcrypt, 'compare', async (raw, hash) => raw === token && hash === 'correspond')
  t.mock.method(model, 'changePasswordAndClearToken', async (...args) => {
    assert.deepEqual(args, ['nouveau-hash', 7, 11])
    return changed
  })
  const res = response()
  await auth.resetPassword({ body: { token, newPassword: 'Fort123!' } }, res)
  assert.equal(res.statusCode, changed ? 200 : 401)
})

for (const [body, status] of [[undefined, 400], [{}, 400], [{ token: 'invalide' }, 401], [{ token: 12 }, 401]]) {
  test(`Renouvellement : refuse la requête ${JSON.stringify(body)}`, async t => {
    setup(t)
    const res = response()
    await auth.refreshTokens({ body }, res)
    assert.equal(res.statusCode, status)
    assert.equal(model.rotateRefreshToken.mock.callCount(), 0)
  })
}

test('Renouvellement : refuse un token inconnu sans créer de session', async t => {
  setup(t)
  t.mock.method(bcrypt, 'compare', async () => false)
  const res = response()
  await auth.refreshTokens({ body: { token } }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(model.rotateRefreshToken.mock.callCount(), 0)
})

for (const rotated of [true, false]) test(`Renouvellement : ${rotated ? 'remplace les jetons et signe le bon utilisateur' : 'refuse un jeton réutilisé'}`, async t => {
  setup(t)
  t.mock.method(model, 'rotateRefreshToken', async (id, uid, hash, expiry) => {
    assert.deepEqual([id, uid, hash], [12, 7, 'nouveau-hash'])
    assert.ok(Math.abs(expiry.getTime() - Date.now() - 7 * 86400000) < 2000)
    return rotated
  })
  const res = response()
  await auth.refreshTokens({ body: { token } }, res)
  assert.equal(res.statusCode, rotated ? 200 : 401)
  if (rotated) {
    const payload = jwt.verify(res.body.accessToken, process.env.JWT_SECRET)
    assert.equal(payload.id, 7)
    assert.equal(payload.exp - payload.iat, 900)
    assert.match(res.body.refreshToken, /^[a-f0-9]{64}$/)
    assert.notEqual(res.body.refreshToken, token)
  }
})

for (const body of [undefined, {}, { token: 'invalide' }]) test(`Déconnexion : refuse un token mal formé (${JSON.stringify(body)})`, async t => {
  setup(t)
  const res = response()
  await auth.logout({ body }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(model.revokeRefreshTokenById.mock.callCount(), 0)
})

for (const match of [true, false]) test(`Déconnexion : ${match ? 'révoque uniquement la session correspondante' : 'reste idempotente pour un token inconnu'}`, async t => {
  setup(t)
  t.mock.method(model, 'findValidRefreshTokens', async () => [
    { id: 10, token_hash: 'autre' }, { id: 12, token_hash: 'correspond' }
  ])
  t.mock.method(bcrypt, 'compare', async (_, hash) => match && hash === 'correspond')
  const res = response()
  await auth.logout({ body: { token } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(model.revokeRefreshTokenById.mock.callCount(), match ? 1 : 0)
  if (match) assert.deepEqual(model.revokeRefreshTokenById.mock.calls[0].arguments, [12])
})

for (const [label, body, title] of [
  ['corps absent', undefined, 'Données invalides'], ['null', null, 'Données invalides'],
  ['texte', 'profil', 'Données invalides'], ['tableau', [], 'Données invalides'],
  ['aucun champ', {}, 'Aucune modification'], ['champ inconnu seul', { role: 'admin' }, 'Aucune modification'],
  ...['email', 'pseudo', 'password', 'avatar_url'].map(key => [`type de ${key}`, { [key]: 123 }, 'Format invalide']),
  ['email', { email: 'invalide' }, 'Email invalide'], ['pseudo vide', { pseudo: '  ' }, 'Pseudo invalide'],
  ...['', 'https://exemple.com/a.png', '//exemple.com/a.png', '/avec espace.png', '/a\\b.png', '/' + 'a'.repeat(2048)].map(avatar_url => ['avatar ' + avatar_url.slice(0, 30), { avatar_url }, 'Avatar invalide']),
  ['mot de passe faible', { password: 'faible' }, 'Mot de passe trop faible']
]) test(`Profil : refuse ${label}`, async t => {
  setup(t)
  const res = response()
  await auth.updateProfile({ body, user: { id: 7 } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.title, title)
  assert.equal(model.updateUser.mock.callCount(), 0)
})

for (const conflict of ['avant', 'pendant']) test(`Profil : signale un doublon ${conflict} la modification`, async t => {
  setup(t)
  if (conflict === 'avant') t.mock.method(model, 'findProfileConflict', async () => ({ id: 8 }))
  else t.mock.method(model, 'updateUser', async () => { throw Object.assign(new Error('doublon'), { code: '23505' }) })
  const res = response()
  await auth.updateProfile({ body: { pseudo: 'Alice' }, user: { id: 7 } }, res)
  assert.equal(res.statusCode, 409)
})

for (const body of [{ pseudo: '  Alice  ' }, { email: ' alice@example.com ', password: 'Fort123!', avatar_url: '/avatar.png' }]) {
  test(`Profil : normalise et ne modifie que les champs fournis (${Object.keys(body)})`, async t => {
    setup(t)
    t.mock.method(model, 'updateUser', async (id, fields) => {
      assert.equal(id, 7)
      assert.deepEqual(fields, {
        email: body.email ? 'alice@example.com' : null,
        pseudo: body.pseudo ? 'Alice' : null,
        hashedPassword: body.password ? 'nouveau-hash' : null,
        avatarUrl: body.avatar_url || null
      })
      return user
    })
    const res = response()
    await auth.updateProfile({ body, user: { id: 7 } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.user.password, undefined)
    assert.deepEqual(res.body.user, { id: 7, email: user.email, pseudo: 'Alice', avatar_url: '/avatar.png' })
  })
}

test('Profil : refuse de modifier un compte supprimé entre-temps', async t => {
  setup(t)
  t.mock.method(model, 'updateUser', async () => null)
  const res = response()
  await auth.updateProfile({ body: { pseudo: 'Alice' }, user: { id: 7 } }, res)
  assert.equal(res.statusCode, 401)
})

for (const body of [undefined, {}, { password: 123, confirmation: 'SUPPRIMER' },
  { password: '', confirmation: 'SUPPRIMER' }, { password: 'x'.repeat(1025), confirmation: 'SUPPRIMER' },
  { password: 'Fort123!', confirmation: 'supprimer' }]) {
  test(`Suppression : exige un mot de passe et la confirmation exacte (${JSON.stringify(body)?.slice(0, 65)})`, async t => {
    setup(t)
    const res = response()
    await auth.deleteAccount({ body, user: { id: 7 } }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(model.deleteAccount.mock.callCount(), 0)
  })
}

for (const scenario of ['absent', 'mot de passe incorrect', 'concurrence', 'succès']) {
  test(`Suppression : ${scenario}`, async t => {
    setup(t)
    t.mock.method(model, 'findAccountForDeletion', async () => scenario === 'absent' ? null : user)
    t.mock.method(bcrypt, 'compare', async () => scenario !== 'mot de passe incorrect')
    t.mock.method(model, 'deleteAccount', async (...args) => {
      assert.deepEqual(args, [7, user.password])
      return scenario !== 'concurrence'
    })
    const res = response()
    await auth.deleteAccount({ body: { password: 'Fort123!', confirmation: 'SUPPRIMER' }, user: { id: 7 } }, res)
    assert.equal(res.statusCode, { absent: 401, 'mot de passe incorrect': 403, concurrence: 409, succès: 204 }[scenario])
    assert.equal(model.deleteAccount.mock.callCount(), ['absent', 'mot de passe incorrect'].includes(scenario) ? 0 : 1)
    if (scenario === 'succès') assert.equal(res.body, undefined)
  })
}
