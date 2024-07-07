# Requirements:
#
# sudo npm install -g @vscode/vsce

all: clean install build

install: clean
	@npm install

clean:
	@rm -rf node_modules/ *.vsix out/ package-lock.json meta.json

build:
	@vsce package
