const $ = (id) => document.getElementById(id);

const state = {
  mode: "problem",
  task: "inventory",
  commands: []
};

const cli = () => $("platform").value === "openshift" ? "oc" : "kubectl";

function q(value) {
  const text = (value || "").trim();
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return "'" + text.replace(/'/g, `'\\''`) + "'";
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ctx() {
  return {
    cli: cli(),
    namespace: $("namespace").value.trim(),
    pod: $("pod").value.trim(),
    container: $("container").value.trim(),
    node: $("node").value.trim(),
    service: $("service").value.trim(),
    host: $("host").value.trim(),
    port: $("port").value.trim()
  };
}

function ns(c) {
  return c.namespace ? ` -n ${q(c.namespace)}` : "";
}

function cf(c) {
  return c.container ? ` -c ${q(c.container)}` : "";
}

function step(title, description, command, note = "") {
  return { title, description, command, note };
}

function missing(fields) {
  const c = ctx();
  return fields.filter(f => !c[f]);
}

function labelFor(field) {
  const labels = {
    namespace: "Namespace",
    pod: "Pod",
    container: "Container",
    node: "Node / Worker",
    service: "Service",
    host: "Host / destino",
    port: "Puerto",
    sshUser: "Usuario SSH",
    localPath: "Ruta local",
    remotePath: "Ruta destino/origen"
  };
  return labels[field] || field;
}

function showValidation(fields) {
  const box = $("validationMessage");
  if (!fields.length) {
    box.classList.add("hidden");
    box.textContent = "";
    return true;
  }

  box.classList.remove("hidden");
  box.innerHTML =
    "<strong>Faltan datos:</strong> " +
    [...new Set(fields)].map(labelFor).join(", ");
  return false;
}

function updateContextNote() {
  const c = ctx();
  const platform = $("platform").value === "openshift" ? "OpenShift (oc)" : "Kubernetes (kubectl)";
  $("contextNote").innerHTML =
    `<strong>Contexto activo:</strong> ${platform}` +
    (c.namespace ? ` · namespace <code>${esc(c.namespace)}</code>` : "") +
    (c.pod ? ` · pod <code>${esc(c.pod)}</code>` : "") +
    (c.container ? ` · container <code>${esc(c.container)}</code>` : "") +
    (c.node ? ` · node <code>${esc(c.node)}</code>` : "");
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-card").forEach(el => {
    el.classList.toggle("active", el.dataset.mode === mode);
  });
  $("problemModeSection").classList.toggle("hidden", mode !== "problem");
  $("taskModeSection").classList.toggle("hidden", mode !== "task");
}

function setTask(task) {
  state.task = task;
  document.querySelectorAll(".task-tab").forEach(el => {
    el.classList.toggle("active", el.dataset.task === task);
  });
  document.querySelectorAll("[data-task-panel]").forEach(el => {
    el.classList.toggle("hidden", el.dataset.taskPanel !== task);
  });
}

function render(steps) {
  state.commands = steps;
  const target = $("runbookContainer");

  if (!steps.length) {
    target.innerHTML = '<div class="empty-state">No seleccionaste ninguna validación o comando.</div>';
    return;
  }

  target.innerHTML = steps.map((s, i) => `
    <article class="runbook-step">
      <div class="runbook-step-header">
        <div>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.description)}</p>
        </div>
        <button class="copy-command" data-i="${i}" type="button">Copiar</button>
      </div>
      <pre class="command-block">${esc(s.command)}</pre>
      ${s.note ? `<div class="runbook-note">${esc(s.note)}</div>` : ""}
    </article>
  `).join("");

  target.querySelectorAll(".copy-command").forEach(btn => {
    btn.addEventListener("click", async () => {
      const item = state.commands[Number(btn.dataset.i)];
      await copyText(item.command, btn);
    });
  });

  $("validationMessage").classList.add("hidden");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const old = button.textContent;
      button.textContent = "Copiado ✓";
      setTimeout(() => button.textContent = old, 1200);
    }
  } catch {
    alert("No fue posible copiar al portapapeles.");
  }
}

function generateProblem() {
  const c = ctx();
  const n = ns(c);
  const container = cf(c);
  const k = c.cli;
  const problem = $("problemType").value;
  const req = {
    "app-not-responding": ["namespace", "pod"],
    "crashloop": ["namespace", "pod"],
    "restarting": ["namespace", "pod"],
    "pending": ["namespace", "pod"],
    "imagepull": ["namespace", "pod"],
    "dns": ["namespace", "pod", "host"],
    "connectivity": ["namespace", "pod", "host", "port"],
    "cpu": ["namespace", "pod"],
    "memory": ["namespace", "pod"],
    "storage": ["namespace", "pod"],
    "config": ["namespace", "pod"]
  };

  const miss = missing(req[problem] || []);
  if (!showValidation(miss)) return;

  const pod = q(c.pod);
  const getPod = `${k} get pod ${pod}${n} -o wide`;
  const describe = `${k} describe pod ${pod}${n}`;
  const logs = `${k} logs ${pod}${n}${container}`;
  const prev = `${k} logs ${pod}${n}${container} --previous`;
  const events = `${k} get events${n} --sort-by=.metadata.creationTimestamp`;

  const s = [];

  if (problem === "app-not-responding") {
    s.push(
      step("1. Estado del pod", "Confirma estado, IP y node.", getPod),
      step("2. Describe del pod", "Busca probes, mounts, scheduling y eventos.", describe),
      step("3. Logs", "Revisa errores de aplicación.", logs),
      step("4. Eventos", "Ordena eventos cronológicamente.", events)
    );
    if (c.service) {
      s.push(
        step("5. Service", "Revisa selector y puertos.", `${k} get svc ${q(c.service)}${n} -o wide`),
        step("6. Endpoints", "Confirma backends disponibles.", `${k} get endpoints ${q(c.service)}${n}`),
        step("7. EndpointSlices", "Revisa endpoints modernos del Service.", `${k} get endpointslices${n} -l kubernetes.io/service-name=${q(c.service)}`)
      );
    }
  }

  if (problem === "crashloop") {
    s.push(
      step("1. Estado", "Confirma CrashLoopBackOff y reinicios.", getPod),
      step("2. Describe", "Busca exit codes, probes y eventos.", describe),
      step("3. Logs actuales", "Logs de la ejecución actual.", logs),
      step("4. Logs anteriores", "Logs de la ejecución previa.", prev),
      step("5. Restart count", "Cantidad de reinicios por container.", `${k} get pod ${pod}${n} -o jsonpath='{.status.containerStatuses[*].restartCount}'`),
      step("6. Eventos", "Busca fallos recientes.", events)
    );
  }

  if (problem === "restarting") {
    s.push(
      step("1. Estado", "Confirma reinicios.", getPod),
      step("2. Restart count", "Cantidad de reinicios.", `${k} get pod ${pod}${n} -o jsonpath='{.status.containerStatuses[*].restartCount}'`),
      step("3. Logs actuales", "Logs actuales.", logs),
      step("4. Logs anteriores", "Logs previos.", prev),
      step("5. Describe", "Busca OOMKilled, probes o exit codes.", describe)
    );
  }

  if (problem === "pending") {
    s.push(
      step("1. Estado", "Confirma Pending y node asignado.", getPod),
      step("2. Describe", "Revisa scheduler, taints, affinity, PVC y recursos.", describe),
      step("3. Eventos", "Busca FailedScheduling.", events),
      step("4. Nodes", "Estado de workers.", `${k} get nodes -o wide`),
      step("5. Recursos de nodes", "CPU y memoria si metrics-server está disponible.", `${k} top nodes`)
    );
  }

  if (problem === "imagepull") {
    s.push(
      step("1. Estado", "Confirma ImagePullBackOff / ErrImagePull.", getPod),
      step("2. Describe", "Revisa registry y autenticación.", describe),
      step("3. Imágenes", "Lista imágenes configuradas.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.containers[*].image}'`),
      step("4. ImagePullSecrets", "Lista referencias a secrets.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.imagePullSecrets[*].name}'`),
      step("5. Eventos", "Busca errores de pull.", events)
    );
  }

  if (problem === "dns") {
    s.push(
      step("1. Resolver DNS", "Prueba con getent.", `${k} exec ${pod}${n}${container} -- getent hosts ${q(c.host)}`),
      step("2. resolv.conf", "Revisa nameserver y search domains.", `${k} exec ${pod}${n}${container} -- cat /etc/resolv.conf`),
      step("3. nslookup", "Alternativa si está disponible.", `${k} exec ${pod}${n}${container} -- nslookup ${q(c.host)}`),
      step("4. CoreDNS", "Lista pods DNS del clúster.", `${k} get pods -n kube-system -l k8s-app=kube-dns -o wide`)
    );
  }

  if (problem === "connectivity") {
    s.push(
      step("1. DNS", "Resuelve el destino.", `${k} exec ${pod}${n}${container} -- getent hosts ${q(c.host)}`),
      step("2. TCP", "Prueba el puerto con nc.", `${k} exec ${pod}${n}${container} -- nc -vz ${q(c.host)} ${q(c.port)}`),
      step("3. HTTP/HTTPS", "Prueba conectividad y TLS.", `${k} exec ${pod}${n}${container} -- curl -vk https://${q(c.host)}:${q(c.port)}`),
      step("4. Estado del pod", "Confirma IP y node.", getPod)
    );
    if (c.service) {
      s.push(
        step("5. Service", "Revisa el Service.", `${k} get svc ${q(c.service)}${n} -o wide`),
        step("6. Endpoints", "Confirma backends.", `${k} get endpoints ${q(c.service)}${n}`)
      );
    }
  }

  if (problem === "cpu") {
    s.push(
      step("1. Uso del pod", "CPU y memoria actuales.", `${k} top pod ${pod}${n}`),
      step("2. Requests / Limits", "Recursos declarados.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.containers[*].resources}'`),
      step("3. Procesos", "Procesos dentro del contenedor.", `${k} exec ${pod}${n}${container} -- ps -ef`),
      step("4. Top nodes", "Compara capacidad de workers.", `${k} top nodes`)
    );
  }

  if (problem === "memory") {
    s.push(
      step("1. Uso del pod", "CPU y memoria actuales.", `${k} top pod ${pod}${n}`),
      step("2. Requests / Limits", "Revisa límites.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.containers[*].resources}'`),
      step("3. Última terminación", "Busca OOMKilled.", `${k} get pod ${pod}${n} -o jsonpath='{.status.containerStatuses[*].lastState.terminated}'`),
      step("4. Describe", "Revisa eventos.", describe)
    );
  }

  if (problem === "storage") {
    s.push(
      step("1. Describe", "Revisa mounts y PVC.", describe),
      step("2. PVC", "Claims del namespace.", `${k} get pvc${n}`),
      step("3. PV", "Volúmenes persistentes.", `${k} get pv`),
      step("4. StorageClass", "Clases de almacenamiento.", `${k} get storageclass`),
      step("5. Filesystem", "Valida mounts y espacio.", `${k} exec ${pod}${n}${container} -- df -h`)
    );
  }

  if (problem === "config") {
    s.push(
      step("1. YAML del pod", "Configuración efectiva.", `${k} get pod ${pod}${n} -o yaml`),
      step("2. Variables", "Variables de entorno.", `${k} exec ${pod}${n}${container} -- env | sort`),
      step("3. ConfigMaps", "Lista ConfigMaps.", `${k} get configmap${n}`),
      step("4. Secret refs", "Muestra referencias sin imprimir valores.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.containers[*].envFrom[*].secretRef.name}'`),
      step("5. Volúmenes", "Configuración de volumes.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.volumes}'`)
    );
  }

  render(s);
}

function generateTask() {
  const c = ctx();
  const k = c.cli;
  const n = ns(c);
  const container = cf(c);
  const task = state.task;
  const s = [];
  let miss = [];

  if (task === "inventory") {
    if ($("invNodes").checked) {
      s.push(
        step("Nodes", "Inventario de workers.", `${k} get nodes -o wide`),
        step("Labels de nodes", "Roles, affinity y scheduling.", `${k} get nodes --show-labels`)
      );
    }
    if ($("invPods").checked) s.push(step("Pods", "Pods de todos los namespaces.", `${k} get pods -A -o wide`));
    if ($("invDeployments").checked) s.push(step("Deployments", "Deployments del clúster.", `${k} get deployments -A`));
    if ($("invServices").checked) s.push(step("Services", "Services y puertos.", `${k} get svc -A`));
    if ($("invConfigMaps").checked) s.push(step("ConfigMaps", "ConfigMaps del clúster.", `${k} get configmap -A`));
    if ($("invStorage").checked) {
      s.push(
        step("PV", "Persistent Volumes.", `${k} get pv`),
        step("PVC", "Persistent Volume Claims.", `${k} get pvc -A`),
        step("StorageClass", "Clases de almacenamiento.", `${k} get storageclass`)
      );
    }
    if ($("invEvents").checked) s.push(step("Eventos", "Eventos ordenados.", `${k} get events -A --sort-by=.metadata.creationTimestamp`));
  }

  if (task === "pod") {
    miss = missing(["namespace", "pod"]);
    const pod = q(c.pod);
    if ($("podStatus").checked) s.push(step("Estado", "Estado, IP y node.", `${k} get pod ${pod}${n} -o wide`));
    if ($("podDescribe").checked) s.push(step("Describe", "Detalle y eventos.", `${k} describe pod ${pod}${n}`));
    if ($("podLogs").checked) s.push(step("Logs", "Logs actuales.", `${k} logs ${pod}${n}${container}`));
    if ($("podPreviousLogs").checked) s.push(step("Logs anteriores", "Ejecución previa.", `${k} logs ${pod}${n}${container} --previous`));
    if ($("podEvents").checked) s.push(step("Eventos", "Eventos del namespace.", `${k} get events${n} --sort-by=.metadata.creationTimestamp`));
    if ($("podYaml").checked) s.push(step("YAML", "Configuración efectiva.", `${k} get pod ${pod}${n} -o yaml`));
  }

  if (task === "access") {
    miss = missing(["namespace", "pod"]);
    const pod = q(c.pod);
    const shell = $("accessShell").value;
    const direct = $("insideCommand").value.trim();

    s.push(step("Abrir shell", "Acceso interactivo.", `${k} exec -it ${pod}${n}${container} -- ${shell}`));
    if (direct) s.push(step("Comando directo", "Ejecuta sin abrir shell.", `${k} exec ${pod}${n}${container} -- ${direct}`));
    if ($("checkProcesses").checked) s.push(step("Procesos", "Lista procesos.", `${k} exec ${pod}${n}${container} -- ps -ef`));
    if ($("checkPorts").checked) s.push(step("Puertos", "Sockets en escucha.", `${k} exec ${pod}${n}${container} -- ss -lntp`));
    if ($("checkDns").checked) s.push(step("DNS", "Revisa resolv.conf.", `${k} exec ${pod}${n}${container} -- cat /etc/resolv.conf`));
    if ($("checkFilesystem").checked) s.push(step("Filesystem", "Espacio y mounts.", `${k} exec ${pod}${n}${container} -- df -h`));
    if ($("checkEnv").checked) s.push(step("Variables", "Variables ordenadas.", `${k} exec ${pod}${n}${container} -- env | sort`));
    if ($("checkHttp").checked && c.host && c.port) s.push(step("HTTP", "Prueba desde el container.", `${k} exec ${pod}${n}${container} -- curl -vk https://${q(c.host)}:${q(c.port)}`));
  }

  if (task === "network") {
    miss = missing(["namespace", "pod"]);
    if (($("netDns").checked || $("netTcp").checked || $("netHttp").checked) && !c.host) miss.push("host");
    if (($("netTcp").checked || $("netHttp").checked) && !c.port) miss.push("port");
    if (($("netService").checked || $("netEndpoints").checked) && !c.service) miss.push("service");

    const pod = q(c.pod);
    if ($("netDns").checked) s.push(step("DNS", "Resuelve host.", `${k} exec ${pod}${n}${container} -- getent hosts ${q(c.host)}`));
    if ($("netTcp").checked) s.push(step("TCP", "Prueba puerto.", `${k} exec ${pod}${n}${container} -- nc -vz ${q(c.host)} ${q(c.port)}`));
    if ($("netHttp").checked) s.push(step("HTTP/HTTPS", "Prueba conectividad.", `${k} exec ${pod}${n}${container} -- curl -vk https://${q(c.host)}:${q(c.port)}`));
    if ($("netService").checked) s.push(step("Service", "Detalle del Service.", `${k} get svc ${q(c.service)}${n} -o wide`));
    if ($("netEndpoints").checked) {
      s.push(
        step("Endpoints", "Backends asociados.", `${k} get endpoints ${q(c.service)}${n}`),
        step("EndpointSlices", "Vista moderna de endpoints.", `${k} get endpointslices${n} -l kubernetes.io/service-name=${q(c.service)}`)
      );
    }
    if ($("netPodIp").checked) s.push(step("Pod IP", "Obtiene PodIP.", `${k} get pod ${pod}${n} -o jsonpath='{.status.podIP}'`));
  }

  if (task === "files") {
    const dir = $("copyDirection").value;
    const local = $("localPath").value.trim();
    const remote = $("remotePath").value.trim();
    const ssh = $("sshUser").value.trim();

    if (!local) miss.push("localPath");
    if (!remote) miss.push("remotePath");

    if (dir === "to-pod" || dir === "from-pod") {
      miss.push(...missing(["namespace", "pod"]));
    } else {
      miss.push(...missing(["node"]));
      if (!ssh) miss.push("sshUser");
    }

    if (dir === "to-pod") {
      s.push(step("Local → Pod", "Copia al pod.", `${k} cp ${q(local)} ${q(c.namespace)}/${q(c.pod)}:${q(remote)}${container}`, "kubectl cp suele requerir tar dentro del contenedor."));
    }
    if (dir === "from-pod") {
      s.push(step("Pod → Local", "Copia desde el pod.", `${k} cp ${q(c.namespace)}/${q(c.pod)}:${q(remote)} ${q(local)}${container}`, "kubectl cp suele requerir tar dentro del contenedor."));
    }
    if (dir === "to-node") {
      s.push(step("Local → Worker", "Transferencia por SCP.", `scp ${q(local)} ${q(ssh)}@${q(c.node)}:${q(remote)}`, "Requiere SSH y permisos sobre el worker."));
    }
  }

  if (task === "resources") {
    if ($("resTopNodes").checked) s.push(step("Top nodes", "CPU y memoria por node.", `${k} top nodes`));
    if ($("resTopPods").checked) s.push(step("Top pods", "CPU y memoria de todos los pods.", `${k} top pods -A`));

    if ($("resPodUsage").checked || $("resRequestsLimits").checked || $("resRestartCount").checked) {
      miss = missing(["namespace", "pod"]);
      const pod = q(c.pod);
      if ($("resPodUsage").checked) s.push(step("Uso del pod", "CPU y memoria del pod.", `${k} top pod ${pod}${n}`));
      if ($("resRequestsLimits").checked) s.push(step("Requests / Limits", "Recursos declarados.", `${k} get pod ${pod}${n} -o jsonpath='{.spec.containers[*].resources}'`));
      if ($("resRestartCount").checked) s.push(step("Restart count", "Reinicios por container.", `${k} get pod ${pod}${n} -o jsonpath='{.status.containerStatuses[*].restartCount}'`));
    }
  }

  if (!showValidation([...new Set(miss)])) return;
  render(s);
}

async function copyAll() {
  if (!state.commands.length) return;
  const text = state.commands.map((s, i) => `# ${i + 1}. ${s.title}\n${s.command}`).join("\n\n");
  await copyText(text, $("copyAllButton"));
}

function clearResults() {
  state.commands = [];
  $("runbookContainer").innerHTML = '<div class="empty-state">Selecciona un problema o una tarea para generar los comandos.</div>';
  $("validationMessage").classList.add("hidden");
}

function clearContext() {
  $("namespace").value = "default";
  $("pod").value = "";
  $("container").value = "";
  $("node").value = "";
  $("service").value = "";
  $("host").value = "";
  $("port").value = "443";
  updateContextNote();
}

document.querySelectorAll(".mode-card").forEach(el => {
  el.addEventListener("click", () => setMode(el.dataset.mode));
});

document.querySelectorAll(".task-tab").forEach(el => {
  el.addEventListener("click", () => setTask(el.dataset.task));
});

["platform","namespace","pod","container","node","service","host","port"].forEach(id => {
  $(id).addEventListener("input", updateContextNote);
  $(id).addEventListener("change", updateContextNote);
});

$("generateProblemButton").addEventListener("click", generateProblem);
$("generateTaskButton").addEventListener("click", generateTask);
$("copyAllButton").addEventListener("click", copyAll);
$("clearResultsButton").addEventListener("click", clearResults);
$("clearContextButton").addEventListener("click", clearContext);

setMode("problem");
setTask("inventory");
updateContextNote();
