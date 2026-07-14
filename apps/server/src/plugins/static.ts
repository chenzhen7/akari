import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'

export default async function staticPlugin(fastify: FastifyInstance) {
  const webDistPath = process.env.WEB_DIST_PATH
  if (!webDistPath) {
    return
  }

  await fastify.register(fastifyStatic, {
    root: resolve(webDistPath),
    wildcard: false,
  })
}
