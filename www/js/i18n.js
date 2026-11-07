// User-facing strings. English is the original wording; Spanish mirrors it.
// The app follows the browser language unless the language selector is set
// by hand, in which case that choice is saved with the other preferences.

export const STRINGS = {
  en: {
    "field.device": "Device",
    "field.channel": "Channel",
    "field.gain": "Input gain",
    "field.level": "Level",
    "field.mode": "SSTV mode",
    "field.language": "Language",
    "device.default": "Default",
    "device.audioInput": "Audio input",
    "device.saved": "Saved device",
    "channel.mono": "Mono",
    "channel.left": "Left",
    "channel.right": "Right",
    "mode.auto": "Auto",
    "run.start": "Start receiving",
    "run.stop": "Stop receiving",
    "theme.toLight": "Light",
    "theme.toDark": "Dark",
    "lang.auto": "Auto",
    "clock.title": "Local time with seconds, UTC underneath",
    "scale.title": "Resize style",
    "scale.pixels": "Pixels",
    "scale.blur": "Blur",
    "action.save": "Save",
    "action.delete": "Delete",
    "action.fullscreen": "Fullscreen",
    "action.reset": "Reset",
    "action.install": "Install app",
    "live": "Live",
    "clear.images": "Clear image memory",
    "calendar.title": "Calendar",
    "calendar.clear": "Clear calendar",
    "calendar.close": "Close",
    "picture.one": "Picture",
    "picture.lower": "picture",
    "mark.open": "Open {name} received at {time}",
    "dow.0": "Sun",
    "dow.1": "Mon",
    "dow.2": "Tue",
    "dow.3": "Wed",
    "dow.4": "Thu",
    "dow.5": "Fri",
    "dow.6": "Sat",
    "month.0": "Jan",
    "month.1": "Feb",
    "month.2": "Mar",
    "month.3": "Apr",
    "month.4": "May",
    "month.5": "Jun",
    "month.6": "Jul",
    "month.7": "Aug",
    "month.8": "Sep",
    "month.9": "Oct",
    "month.10": "Nov",
    "month.11": "Dec",
    "confirm.deleteImage": "Delete this picture? This cannot be undone.",
    "confirm.clearImages": "Delete every saved picture? This cannot be undone.",
    "confirm.clearCalendar": "Delete every program from the calendar? This cannot be undone.",
    "error.mic": "Microphone unavailable",
    "error.noMicAccess": "This browser has no microphone access",
    "error.png": "Could not encode the picture",
    "error.noIndexedDB": "This browser has no IndexedDB",
    "error.idbOpen": "IndexedDB could not be opened",
    "error.idbBlocked": "IndexedDB is blocked by another tab",
    "error.idbRequest": "IndexedDB request failed",
    "error.idbAbort": "IndexedDB transaction aborted",
    "error.idbWrite": "IndexedDB write failed",
    "error.idbWriteAbort": "IndexedDB write aborted",
    "error.micDenied": "Microphone permission was denied",
    "error.micMissing": "No microphone was found",
    "error.micBusy": "The microphone is busy or cannot be read",
    "error.micConstraint": "The selected microphone is not available",
    "error.micAbort": "The microphone could not be started",
    "mark.welcome": "Welcome",
    "mark.bye": "Bye",
    "mark.pre": "Pre-bumper",
    "mark.post": "Post-bumper",
  },
  es: {
    "field.device": "Dispositivo",
    "field.channel": "Canal",
    "field.gain": "Ganancia de entrada",
    "field.level": "Nivel",
    "field.mode": "Modo SSTV",
    "field.language": "Idioma",
    "device.default": "Predeterminado",
    "device.audioInput": "Entrada de audio",
    "device.saved": "Dispositivo guardado",
    "channel.mono": "Mono",
    "channel.left": "Izquierda",
    "channel.right": "Derecha",
    "mode.auto": "Automático",
    "run.start": "Iniciar recepción",
    "run.stop": "Detener recepción",
    "theme.toLight": "Claro",
    "theme.toDark": "Oscuro",
    "lang.auto": "Automático",
    "clock.title": "Hora local con segundos, UTC debajo",
    "scale.title": "Estilo de escala",
    "scale.pixels": "Píxeles",
    "scale.blur": "Desenfoque",
    "action.save": "Guardar",
    "action.delete": "Eliminar",
    "action.fullscreen": "Pantalla completa",
    "action.reset": "Restablecer",
    "action.install": "Instalar app",
    "live": "En vivo",
    "clear.images": "Borrar imágenes",
    "calendar.title": "Calendario",
    "calendar.clear": "Borrar calendario",
    "calendar.close": "Cerrar",
    "picture.one": "Imagen",
    "picture.lower": "imagen",
    "mark.open": "Abrir {name}, recibida a las {time}",
    "dow.0": "Dom",
    "dow.1": "Lun",
    "dow.2": "Mar",
    "dow.3": "Mié",
    "dow.4": "Jue",
    "dow.5": "Vie",
    "dow.6": "Sáb",
    "month.0": "ene",
    "month.1": "feb",
    "month.2": "mar",
    "month.3": "abr",
    "month.4": "may",
    "month.5": "jun",
    "month.6": "jul",
    "month.7": "ago",
    "month.8": "sep",
    "month.9": "oct",
    "month.10": "nov",
    "month.11": "dic",
    "confirm.deleteImage": "¿Eliminar esta imagen? No se puede deshacer.",
    "confirm.clearImages": "¿Borrar todas las imágenes guardadas? No se puede deshacer.",
    "confirm.clearCalendar": "¿Borrar todos los programas del calendario? No se puede deshacer.",
    "error.mic": "Micrófono no disponible",
    "error.noMicAccess": "Este navegador no tiene acceso al micrófono",
    "error.png": "No se pudo codificar la imagen",
    "error.noIndexedDB": "Este navegador no tiene IndexedDB",
    "error.idbOpen": "No se pudo abrir IndexedDB",
    "error.idbBlocked": "Otra pestaña está bloqueando IndexedDB",
    "error.idbRequest": "Falló una solicitud a IndexedDB",
    "error.idbAbort": "Se canceló una transacción de IndexedDB",
    "error.idbWrite": "Falló la escritura en IndexedDB",
    "error.idbWriteAbort": "Se canceló la escritura en IndexedDB",
    "error.micDenied": "Se denegó el permiso del micrófono",
    "error.micMissing": "No se encontró ningún micrófono",
    "error.micBusy": "El micrófono está ocupado o no se puede leer",
    "error.micConstraint": "El micrófono seleccionado no está disponible",
    "error.micAbort": "No se pudo iniciar el micrófono",
    "mark.welcome": "Bienvenida",
    "mark.bye": "Despedida",
    "mark.pre": "Cortinilla previa",
    "mark.post": "Cortinilla posterior",
  },
};

let locale = "en";

export function getLocale() {
  return locale;
}

export function setLocale(next) {
  locale = next === "es" ? "es" : "en";
}

export function detectLocale() {
  const tags = [];
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages) && navigator.languages.length) tags.push(...navigator.languages);
    else if (navigator.language) tags.push(navigator.language);
  }
  for (const tag of tags) {
    const lang = String(tag).toLowerCase();
    if (lang.startsWith("es")) return "es";
    if (lang.startsWith("en")) return "en";
  }
  return "en";
}

export function t(key, vars) {
  const table = STRINGS[locale] || STRINGS.en;
  let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : STRINGS.en[key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }
  return text;
}
