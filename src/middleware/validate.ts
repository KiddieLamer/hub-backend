import { Context, Next } from 'hono'
import { ZodError, type ZodType, type infer as ZodInfer } from 'zod'

export type ValidationSource = 'json' | 'query' | 'param'

export type ValidatedVariables = {
  validatedBody: unknown
  validatedQuery: unknown
  validatedParam: unknown
}

const KEY_BY_SOURCE: Record<ValidationSource, keyof ValidatedVariables> = {
  json: 'validatedBody',
  query: 'validatedQuery',
  param: 'validatedParam',
}

/**
 * Middleware validasi Zod yang seragam.
 *
 * - Mem-parse body/query/param sesuai `source`.
 * - Jika gagal, melempar ZodError agar ditangkap `errorMiddleware`
 *   (format respons konsisten: { error, details }).
 * - Jika sukses, hasil parse disimpan via `c.set(...)` sehingga route
 *   bisa mengambilnya lewat `getValidated(c, source)`.
 *
 * Contoh pemakaian:
 *   router.post('/', validate(createSchema, 'json'), (c) => {
 *     const body = getValidated<typeof createSchema>(c, 'json')
 *     ...
 *   })
 */
export function validate<S extends ZodType>(schema: S, source: ValidationSource = 'json') {
  return async (c: Context, next: Next) => {
    let input: unknown

    if (source === 'json') {
      // Toleran terhadap body kosong / bukan JSON -> biar Zod yang menentukan.
      input = await c.req.json().catch(() => ({}))
    } else if (source === 'query') {
      input = c.req.query()
    } else {
      input = c.req.param()
    }

    const data = schema.parse(input) as ZodInfer<S>

    c.set(KEY_BY_SOURCE[source], data)

    await next()
  }
}

/**
 * Ambil data yang sudah divalidasi oleh `validate()`.
 * Mengembalikan `undefined` bila belum divalidasi.
 */
export function getValidated<S extends ZodType>(
  c: Context,
  source: ValidationSource = 'json'
): ZodInfer<S> | undefined {
  return c.get(KEY_BY_SOURCE[source] as never) as ZodInfer<S> | undefined
}

export { ZodError }
