.PHONY: build clean
build:
	@mkdir -p build
	@pdflatex -output-directory=build -synctex=1 -interaction=nonstopmode "paper".tex
	@bibtex build/"paper".aux
	@pdflatex -output-directory=build -synctex=1 -interaction=nonstopmode "paper".tex
	@pdflatex -output-directory=build -synctex=1 -interaction=nonstopmode "paper".tex

clean:
	@rm -rf build
