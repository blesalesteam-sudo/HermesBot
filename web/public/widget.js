/* hermesBot · widget para incrustar un bot en otra web.
 *
 * Se pega una sola línea (la da Ajustes > Widgets):
 *   <script src="https://TU-HERMESBOT/widget.js" data-token="LLAVE" async></script>
 *
 * Opciones (todas opcionales, como atributos de esa línea):
 *   data-name="Marta"        nombre de quien escribe, para que el equipo lo vea en el chat
 *   data-side="left"         esquina del botón (por defecto, derecha)
 *   data-color="#126fd4"     color del botón
 *   data-theme="dark|light"  por defecto sigue al sistema
 *   data-target="#panel"     en vez de botón flotante, muestra el chat dentro de ese elemento
 */
(function () {
  var script = document.currentScript
  var token = script && script.getAttribute('data-token')

  if (!token || window.hermesBot) { return }

  var base = new URL(script.src).origin
  var opt = function (key, fallback) { return script.getAttribute('data-' + key) || fallback }
  var name = opt('name', '')
  var frame = null
  var panel = null
  var button = null

  function src(mode) {
    return base + '/embed?token=' + encodeURIComponent(token) + '&name=' + encodeURIComponent(name) + '&mode=' + mode +
      (opt('theme', '') ? '&theme=' + encodeURIComponent(opt('theme', '')) : '')
  }

  function makeFrame(mode) {
    var f = document.createElement('iframe')

    f.src = src(mode)
    f.title = 'Asistente'
    f.allow = 'microphone; clipboard-write'
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent'

    return f
  }

  function mount() {
    var target = opt('target', '') && document.querySelector(opt('target', ''))

    if (target) {
      frame = makeFrame('inline')
      target.appendChild(frame)

      return
    }

    var side = opt('side', 'right') === 'left' ? 'left' : 'right'

    button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', 'Abrir el asistente')
    button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>'
    button.style.cssText = 'position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;width:52px;height:52px;border-radius:50%;' +
      'border:1px solid rgba(0,0,0,.14);background:' + opt('color', '#1c1c1c') + ';color:#fff;display:grid;place-items:center;cursor:pointer;padding:0'
    button.onclick = function () { api.toggle() }

    panel = document.createElement('div')
    panel.style.cssText = 'position:fixed;z-index:2147483001;display:none;overflow:hidden;background:#fff;border:1px solid rgba(0,0,0,.16)'
    place()
    window.addEventListener('resize', place)
    document.body.appendChild(panel)
    document.body.appendChild(button)

    function place() {
      var small = window.innerWidth < 560

      panel.style.inset = small ? '0' : 'auto'
      panel.style.width = small ? 'auto' : '390px'
      panel.style.height = small ? 'auto' : 'min(640px, calc(100vh - 110px))'
      panel.style.borderRadius = small ? '0' : '18px'
      panel.style.bottom = small ? '0' : '84px'
      panel.style[side] = small ? '0' : '20px'
    }
  }

  var api = {
    open: function () {
      if (!panel) { return }
      if (!frame) { frame = makeFrame('float'); panel.appendChild(frame) }

      panel.style.display = 'block'
    },
    close: function () { if (panel) { panel.style.display = 'none' } },
    toggle: function () { if (panel && panel.style.display === 'block') { api.close() } else { api.open() } },
    /** Cambia el nombre de quien escribe (por ejemplo, tras iniciar sesión en tu web). */
    setName: function (value) {
      name = String(value || '')

      if (frame) { frame.src = src(panel ? 'float' : 'inline') }
    }
  }

  window.hermesBot = api
  window.addEventListener('message', function (e) {
    if (e.origin === base && e.data && e.data.hermesBot === 'close') { api.close() }
  })

  if (document.body) { mount() } else { document.addEventListener('DOMContentLoaded', mount) }
})()
