'use strict';
const isProd = process.env.NODE_ENV === 'production'

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression')
const serialize = require('serialize-javascript')
const debug = require('debug')('fundation')
const favicon = require('serve-favicon')
const resolve = file => path.resolve(__dirname, file)
const pjson = require('./package.json')

module.exports = function fundation (options) {
  const app = express()

  app.once('mount', function onmount(parent) {
    // Remove sacrificial express app (krakenjs)
    parent._router.stack.pop()

    // Fundation root path
    parent.fundationRoot = __dirname
    parent.applicationRoot = path.resolve(__dirname + '/../../')

    // Config
    require('./lib/config.js')(parent)

    let indexHTML // generated by html-webpack-plugin
    let renderer  // created from the webpack-generated server bundle
    if (isProd) {
      // in production: create server renderer and index HTML from real fs
      renderer = createRenderer(fs.readFileSync(resolve('./dist/server-bundle.js'), 'utf-8'))
      indexHTML = parseIndex(fs.readFileSync(resolve('./dist/index.html'), 'utf-8'))
    } else {
      // in development: setup the dev server with watch and hot-reload,
      // and update renderer / index HTML on file change.
      require('./build/setup-dev-server')(parent, {
        bundleUpdated: bundle => {
          renderer = createRenderer(bundle)
        },
        indexUpdated: index => {
          indexHTML = parseIndex(index)
        }
      })
    }

    function createRenderer (bundle) {
      // https://github.com/vuejs/vue/blob/next/packages/vue-server-renderer/README.md#why-use-bundlerenderer
      return require('vue-server-renderer').createBundleRenderer(bundle, {
        cache: require('lru-cache')({
          max: 1000,
          maxAge: 1000 * 60 * 15
        })
      })
    }

    function parseIndex (template) {
      const contentMarker = '<!-- APP -->'
      const i = template.indexOf(contentMarker)

      return {
        head: template.slice(0, i),
        tail: template.slice(i + contentMarker.length)
      }
    }

    const serve = (path, cache) => express.static(resolve(path), {
      maxAge: cache && isProd ? 60 * 60 * 24 * 30 : 0
    })

    parent.use(compression({ threshold: 0 }))
    // parent.use(favicon('../../public/logo-48.png')
    parent.use('/service-worker.js', serve('../../dist/service-worker.js'))
    parent.use('/manifest.json', serve('../../manifest.json'))
    parent.use('/dist', serve('../../dist'))
    parent.use('/public', serve('../../public'))

    parent.get('*', (req, res) => {
      if (!renderer) {
        return res.end('waiting for compilation... refresh in a moment.')
      }

      res.setHeader("Content-Type", "text/html");
      var s = Date.now()
      const context = { url: req.url }
      const renderStream = renderer.renderToStream(context)

      renderStream.once('data', () => {
        res.write(indexHTML.head)
      })

      renderStream.on('data', chunk => {
        res.write(chunk)
      })

      renderStream.on('end', () => {
        // embed initial store state
        if (context.initialState) {
          res.write(
            `<script>window.__INITIAL_STATE__=${
              serialize(context.initialState, { isJSON: true })
            }</script>`
          )
        }
        res.end(indexHTML.tail)
        console.log(`whole request: ${Date.now() - s}ms`)
      })

      renderStream.on('error', err => {
        if (err && err.code === '404') {
          res.status(404).end('404 | Page Not Found')
          return
        }
        // Render Error Page or Redirect
        res.status(500).end('Internal Error 500')
        console.error(`error during render : ${req.url}`)
        console.error(err)
      })

    });
  });

  console.log("Fundation: v" + pjson.version);
  return app;
};
