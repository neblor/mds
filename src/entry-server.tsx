// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
	<StartServer
		document={({ assets, children, scripts }) => (
			<html lang="zh-CN">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>默点啥</title>
					<link rel="icon" href="/favicon.ico" />
					<link
						rel="stylesheet"
						href="/fonts/sarasa-ui-sc/SarasaUiSC-Regular.css"
					/>
					{assets}
				</head>
				<body>
					<div id="app">{children}</div>
					{scripts}
				</body>
			</html>
		)}
	/>
));
