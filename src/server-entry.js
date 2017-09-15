import { app, router, store } from './app'
import { sync } from 'vuex-router-sync'

const isDev = process.env.NODE_ENV !== 'production'

// Sync the router with the vuex store.
// This registers `store.state.route`
sync(store, router)

// This exported function will be called by `bundleRenderer`.
// This is where we perform data-prefetching to determine the
// state of our application before actually rendering it.
// Since data fetching is async, this function is expected to
// return a Promise that resolves to the app instance.
export default context => {
  return new Promise((resolve, reject) => {

    // put the postbody in the store
    if (context.post) {
      store.state.post = context.post
    }

    // Put the cookies in the store
    if (context.cookies) {
      store.state.cookies = context.cookies
    }

    // Put the config in the store
    if (context.config) {
      store.state.config = context.config
    }

    // set router's location
    router.push(context.url)

    // wait until router has resolved possible async hooks
    router.onReady(() => {
      const matchedComponents = router.getMatchedComponents()
      // no matched routes
      if (!matchedComponents.length) {
        reject({ code: 404 })
      }

      const meta = app.$meta()

      // Call preFetch hooks on components matched by the route.
      // A preFetch hook dispatches a store action and returns a Promise,
      // which is resolved when the action is complete and store state has been
      // updated.
      Promise.all(matchedComponents.map(component => {
        return component.preFetch && component.preFetch(store)
      })).then(() => {
        // After all preFetch hooks are resolved, our store is now
        // filled with the state needed to render the app.
        // Expose the state on the render context, and let the request handler
        // inline the state in the HTML response. This allows the client-side
        // store to pick-up the server-side state without having to duplicate
        // the initial data fetching on the client.
        context.state = store.state
        context.meta = meta
        resolve(app)
      }).catch(error => {
        if (_.get(error, 'type', '') === 'redirect') {
          return reject({
            type: _.get(error, 'type', 'redirect'),
            code: _.get(error, 'code', 301),
            url: _.get(error, 'url', ''),
          })
        }

        context.state = store.state
        context.meta = meta
        resolve(app)
      })
    })
  })
}
