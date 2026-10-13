const { badRequest } = require('./errors');

/** validate(schema, 'body'|'query'|'params') -> stores parsed result on req.valid[source] */
const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || source}: ${i.message}`).join('; ');
    throw badRequest(msg, 'VALIDATION');
  }
  req.valid = { ...(req.valid || {}), [source]: parsed.data };
  next();
};

module.exports = { validate };
