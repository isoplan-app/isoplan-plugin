import { createApp } from "vue";
import { passViewErrors } from "../shared/view-errors.ts";
import App from "./App.vue";
import { rpc } from "./rpc.ts";

const app = createApp(App);
passViewErrors(app, (error) => rpc.send.error(error));
app.mount("#app");
