export default {
  commands: {
    addTodayToFrontmatter: "Agregar datos de salud de hoy a las propiedades del archivo activo",
    addDateToFrontmatter: "Agregar datos de salud de una fecha a las propiedades del archivo activo",
  },
  notices: {
    noteCreated: (date: string) => `¡Nota de Garmin (${date}) creada!`,
    noActiveFile: "No hay archivo activo",
    invalidDate: "Fecha inválida",
    addedToFile: "Datos de Garmin agregados al archivo activo",
    fetchError: "No se pueden obtener los datos de salud",
    interactiveAuth: "Inicio de sesión de Garmin bloqueado: se devolvió autenticación interactiva. Usa autenticación externa o sin interfaz.",
  },
  modal: {
    dateLabel: "Fecha (DD-MM-YYYY)",
    ok: "OK",
    cancel: "Cancelar",
    loading: "Obteniendo datos de Garmin…",
  },
  settings: {
    title: "Health Connector",
    username: "Nombre de usuario",
    usernameDesc: "Tu login de Garmin Connect",
    password: "Contraseña",
    passwordDesc: "Tu contraseña de Garmin Connect",
    labelShowPassword: "Mostrar contraseña",
    labelHidePassword: "Ocultar contraseña",
    vaultFolder: "Carpeta de almacenamiento",
    vaultFolderDesc: "Dónde guardar las notas de Garmin en tu vault",
    supportTitle: "Apoya el desarrollo",
    supportDesc: "Si te gusta poder ver tus datos de Garmin en Obsidian, considera apoyar su desarrollo",
    supportButton: "☕️ Propina",
  },
  template: {
    title: "Estadísticas de Salud",
    steps: "Pasos",
    weight: "Peso",
    avgHeartRate: "Frecuencia cardíaca promedio",
    running: "Correr",
    cycling: "Ciclismo",
    swimming: "Natación",
    noData: "N/A",
  }
};
