export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js")
    ) {
      return defaultResolve(
        `${specifier.slice(0, -3)}.ts`,
        context,
        defaultResolve,
      );
    }

    throw error;
  }
}
