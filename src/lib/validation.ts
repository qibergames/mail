import { z } from 'zod'

export const hostnameSchema = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
export const localPartSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
