const API_URL = "http://127.0.0.1:8000/api/games/";
const status = document.querySelector("#status");
const games = document.querySelector("#games");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const reload = document.querySelector("#reload");
let page = 1;

async function loadGames() {
  previous.disabled = true;
  next.disabled = true;
  reload.disabled = true;
  status.textContent = "Завантаження ігор…";
  games.replaceChildren();
  document.querySelector("#page").textContent = `Сторінка ${page}`;
  try {
    const response = await fetch(`${API_URL}?page=${page}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail);
    for (const game of data.results) {
      const row = document.createElement("tr");
      for (const value of [
        game.name,
        game.description,
        `${game.min_players}–${game.max_players}`,
        `${game.duration_minutes} хв`,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      games.append(row);
    }
    status.textContent = data.count
      ? `Ігор у каталозі: ${data.count}`
      : "Каталог поки порожній. Додайте гру через API або Postman.";
    previous.disabled = page <= 1;
    next.disabled = page * 20 >= data.count;
  } catch {
    status.textContent =
      "Не вдалося завантажити ігри. Перевірте, чи запущений бекенд на порту 8000, та натисніть «Оновити».";
    previous.disabled = page <= 1;
  } finally {
    reload.disabled = false;
  }
}

previous.addEventListener("click", () => {
  page -= 1;
  loadGames();
});
next.addEventListener("click", () => {
  page += 1;
  loadGames();
});
reload.addEventListener("click", loadGames);
loadGames();
