import app from "./src/app";

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
	console.log(`Résa reservation service listening on http://localhost:${PORT}`);
});
